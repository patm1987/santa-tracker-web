#!/usr/bin/env node

/**
 * @fileoverview Builds Santa Tracker for release to production.
 */

const color = require('ansi-colors');
const compileCss = require('./build/compile-css.js');
const dom = require('./build/dom.js');
const fsp = require('./build/fsp.js');
const globAll = require('./build/glob-all.js');
const isUrl = require('./build/is-url.js');
const releaseHtml = require('./build/release-html.js');
const log = require('fancy-log');
const path = require('path');
const loader = require('./loader.js');
const i18n = require('./build/i18n.js');
require('json5/lib/register');

// Generates a version like `vYYYYMMDDHHMM`, in UTC time.
const DEFAULT_STATIC_VERSION = 'v' + (new Date).toISOString().replace(/[^\d]/g, '').substr(0, 12);

const yargs = require('yargs')
    .strict()
    .epilogue('https://github.com/google/santa-tracker-web')
    .option('build', {
      alias: 'b',
      type: 'string',
      default: DEFAULT_STATIC_VERSION,
      describe: 'production build tag',
    })
    .option('default-lang', {
      type: 'string',
      default: 'en',
      describe: 'default top-level language',
    })
    .option('default-only', {
      alias: 'o',
      type: 'boolean',
      default: false,
      describe: 'only generate default top-level language',
    })
    .option('baseurl', {
      type: 'string',
      default: 'https://maps.gstatic.com/mapfiles/santatracker/',
      describe: 'URL to static content',
    })
    .option('prod', {
      type: 'string',
      default: 'https://santatracker.google.com/',
      describe: 'base prod URL',
    })
    .option('api-base', {
      type: 'string',
      default: 'https://santa-api.appspot.com/',
      describe: 'base URL for Santa\'s API',
    })
    .option('autoprefixer', {
      type: 'string',
      default: '> 3%, chrome >= 44, ios_saf >= 9, ie >= 11',
      describe: 'browsers to run autoprefixer for',
    })
    .argv;

const staticAssets = [
  'audio/*',
  'img/**/*',
  '!img/**/*_og.png',  // don't include OG images, too large
  'third_party/**',
  'scenes/**/models/**',
  'scenes/**/img/**',
  // 'components/url/*.js',
  // TODO(samthor): Better support for custom scenes (#1679).
  // 'scenes/snowflake/snowflake-maker/{media,third-party}/**',
  // 'scenes/snowball/models/*',
];

function pathForLang(lang) {
  if (lang === yargs.defaultLang) {
    return '.';
  }
  return `intl/${lang}_ALL`
}

async function copy(src, dst) {
  await fsp.mkdirp(path.dirname(dst));
  await fsp.copyFile(src, dst);
}

function releaseAll(all) {
  const copies = all.map((p) => copy(p, path.join('dist', p)));
  return Promise.all(copies);
}

async function write(target, content) {
  await fsp.mkdirp(path.dirname(target));
  await fsp.writeFile(target, content);
}

async function releaseAssets(target, ...all) {
  const assetsToCopy = globAll(...all);
  log(`Copying ${color.blue(assetsToCopy.length)} ${target} assets`);
  for (const asset of assetsToCopy) {
    const targetAssetPath = path.join('dist', target, asset);
    await fsp.mkdirp(path.dirname(targetAssetPath));
    await fsp.copyFile(asset, targetAssetPath);
  }
}

/**
 * @param {string} id of the scene
 * @param {?Object} info from scenes.js
 * @return {string} msgid to use for naming the scene
 */
function msgidForScene(id, info) {
  if (!id || !info) {
    return 'santatracker';
  } else if ('msgid' in info) {
    return info.msgid;
  } else if (info.video) {
    return `scene_videoscene_${id}`;
  } else {
    return `scene_${id}`;
  }
}

/**
 * Returns virtual module content for Rollup. This performs one of two tasks:
 *   1) extracts base64-encoded code from a "virtual" import (one generated from inside HTML)
 *   2) returns a Promise for Closure scene compilation
 */
function virtualModuleContent(id, importer) {
  if (importer === undefined) {
    const virtualSplitIndex = id.indexOf('::\0');
    if (virtualSplitIndex !== -1) {
      const buf = Buffer.from(id.slice(virtualSplitIndex + 3), 'base64');
      return buf.toString();
    }
  }

  if (!id.startsWith('./') && !id.startsWith('../')) {
    return undefined;  // not a real file
  }

  // Find where the target source file lives relative to the root.
  const dir = path.dirname(importer);
  const resolved = path.relative(__dirname, path.resolve(dir, id));

  // If it matches a scene, return a Promise for its compilation.
  const sceneName = matchSceneMin(resolved);
  if (sceneName !== null) {
    return (async () => {
      const {js, sourceMap} = await compileScene({sceneName}, true);
      return {code: js, map: sourceMap};
    })();
  }
}


async function release() {
  log(`Building Santa Tracker ${color.red(yargs.build)}...`);
  await fsp.mkdirp('dist/static');
  await fsp.mkdirp('dist/prod');

  const staticPath = `${yargs.baseurl}${yargs.build}/`;

  // Find the list of languages by reading `_messages`.
  const missingMessages = {};
  const langs = i18n.all((lang, msgid) => {
    if (!(msgid in missingMessages)) {
      missingMessages[msgid] = new Set();
    }
    missingMessages[msgid].add(lang);
  });
  if (!(yargs.defaultLang in langs)) {
    throw new Error(`default lang '${yargs.defaultLang}' not found in _messages`);
  }
  if (yargs.defaultOnly) {
    Object.keys(langs).forEach((otherLang) => {
      if (otherLang !== yargs.defaultLang) {
        delete langs[otherLang];
      }
    });
  }
  log(`Found ${color.cyan(Object.keys(langs).length)} languages`);

  // Fanout these scenes in prod.
  const scenes = require('./scenes.json5');
  log(`Found ${color.cyan(Object.keys(scenes).length)} scenes`);

  // Release all non-HTML prod assets.
  const prodAll = globAll('prod/**', '!prod/*.html', '!prod/manifest.json');
  await releaseAll(prodAll);

  // Match non-index.html prod pages, like cast, error etc.
  let prodHtmlCount = 0;
  const prodOtherHtml = globAll('prod/*.html', '!prod/index.html');
  for (const htmlFile of prodOtherHtml) {
    const documentForLang = await releaseHtml.prod(htmlFile, (document) => {
      releaseHtml.applyAttribute(document.body, 'data-static', staticPath);
    });

    const tail = path.basename(htmlFile);
    for (const lang in langs) {
      const target = path.join('dist/prod', pathForLang(lang), tail);
      const out = documentForLang(langs[lang]);
      await write(target, out);
      ++prodHtmlCount;
    }
  }

  // Fanout prod index.html to all scenes and langs.
  for (const sceneName in scenes) {
    const documentForLang = await releaseHtml.prod('prod/index.html', async (document) => {
      const head = document.head;
      releaseHtml.applyAttribute(document.body, 'data-static', staticPath);
      releaseHtml.applyAttribute(document.body, 'data-version', yargs.build);

      const image = `prod/images/og/${sceneName}.png`;
      if (await fsp.exists(image)) {
        const url = `${yargs.prod}images/og/${sceneName}.png`;
        const all = [
          '[property="og:image"]',
          '[name="twitter:image"]',
        ];
        releaseHtml.applyAttributeToAll(head, all, 'content', url);
      }

      const msgid = msgidForScene(sceneName, scenes[sceneName]);
      const all = ['title', '[property="og:title"]', '[name="twitter:title"]'];
      releaseHtml.applyAttributeToAll(head, all, 'msgid', msgid);
    });

    for (const lang in langs) {
      const filename = sceneName === '' ? 'index.html' : `${sceneName}.html`;
      const target = path.join('dist/prod', pathForLang(lang), filename);
      const out = documentForLang(langs[lang]);
      await write(target, out);
      ++prodHtmlCount;
    }
  }

  log(`Written ${color.cyan(prodHtmlCount)} prod HTML files`);

  // Generate manifest.json for every language.
  const manifest = require('./prod/manifest.json');
  for (const lang in langs) {
    const messages = langs[lang];
    manifest['name'] = messages('santatracker');
    // TODO(samthor): Waiting for 'santa' to be translated for `short_name`.
    const target = path.join('dist/prod', pathForLang(lang), 'manifest.json');
    await write(target, JSON.stringify(manifest));
  }

  // Shared resources needed by prod build.
  const entrypoints = new Map();
  const virtualScripts = new Map();
  const requiredScriptSources = new Set();

  // Santa Tracker builds static by finding HTML entry points and parsing/rewriting each file,
  // including traversing their dependencies like CSS and JS. It doesn't specifically compile CSS 
  // or JS on its own, it must be included by one of our HTML entry points.
  // FIXME(samthor): Bundle code is only loaded imperatively. Need to fix.
  const loader = require('./loader.js')({compile: true});
  const htmlFiles = ['index.html'].concat(globAll('scenes/*/index.html'));
  const htmlDocuments = new Map();
  for (const htmlFile of htmlFiles) {
    const dir = path.dirname(htmlFile);
    const document = await dom.read(htmlFile);
    htmlDocuments.set(htmlFile, document);

    const styleLinks = [...document.querySelectorAll('link[rel="stylesheet"]')];
    const allScripts = Array.from(document.querySelectorAll('script')).filter((scriptNode) => {
      return !(scriptNode.src && isUrl(scriptNode.src));
    });

    // Add release/build notes to HTML.
    document.body.setAttribute('data-version', yargs.build);
    const devNode = document.getElementById('DEV');
    devNode && devNode.remove();

    // Inline all referenced styles which are available locally.
    for (const styleLink of styleLinks) {
      if (isUrl(styleLink.href)) {
        continue;
      }
      const out = await loader(path.join(dir, styleLink.href), {compile: true});
      const inlineStyleTag = document.createElement('style');
      inlineStyleTag.innerHTML = out.body;
      styleLink.parentNode.replaceChild(inlineStyleTag, styleLink);
    }

    // Find non-module scripts, as they contain dependencies like jQuery, THREE.js etc. These are
    // catalogued and then included in the production output.
    allScripts
        .filter((s) => s.src && (!s.type || s.type === 'text/javascript'))
        .map((s) => path.join(dir, s.src))
        .forEach((src) => requiredScriptSources.add(src));

    // Find all module scripts, so that all JS entrypoints can be catalogued and built together.
    const moduleScriptNodes = allScripts.filter((s) => s.type === 'module');
    for (const scriptNode of moduleScriptNodes) {
      let code = scriptNode.textContent;

      // If it's an external script, pretend that we have local code that imports it.
      if (scriptNode.src) {
        let src = scriptNode.src;
        if (!src.startsWith('.')) {
          src = `./${src}`;
        }
        code = `import '${src}';`
      }
      const id = `e${entrypoints.size}.js`;
      entrypoints.set(id, {scriptNode, dir, code});

      // clear scriptNode
      scriptNode.textContent = '';
      scriptNode.removeAttribute('src');
    }
  }
  log(`Found ${color.cyan(entrypoints.size)} module entrypoints`);

  // Awkwardly insert rollup step in the middle of the release process.
  // TODO(samthor): refactor out?
  const rollup = require('rollup');
  const rollupNodeResolve = require('rollup-plugin-node-resolve');
  const terser = require('terser');
  const virtualCache = {};
  const virtualLoader = {
    name: 'rollup-virtual-loader-release',
    async resolveId(id, importer) {
      if (importer === undefined) {
        const data = entrypoints.get(id);
        virtualCache[id] = data.code;
        return id;
      }

      const data = entrypoints.get(importer);
      const resolved = path.resolve(data ? data.dir : path.dirname(importer), id);

      // try the loader
      const out = await loader(resolved, {compile: true});
      if (out) {
        virtualCache[resolved] = out.body.toString();
        return resolved;
      }
    },
    load(id) {
      return virtualCache[id];
    },
  };
  const bundle = await rollup.rollup({
    experimentalCodeSplitting: true,
    input: Array.from(entrypoints.keys()),
    plugins: [rollupNodeResolve(), virtualLoader],
  });

  const generated = await bundle.generate({
    format: 'es',
    chunkFileNames: 'c[hash].js',
  });
  log(`Generated ${color.cyan(Object.keys(generated.output).length)} total modules`);

  const babel = require('@babel/core');
  const buildTemplateTagReplacer = require('./build/babel/template-tag-replacer.js');

  let totalSizeES = 0;
  for (const filename in generated.output) {
    const {isEntry, code} = generated.output[filename];

    if (isEntry) {
      // TODO(samthor): can we determine the tree here and add preloads?
      const {scriptNode, dir} = entrypoints.get(filename);
      scriptNode.setAttribute('src', path.relative(dir, `src/${filename}`));
    }

    const templateTagReplacer = (name, arg) => {
      if (name === '_style') {
        return compileCss(`styles/${arg}.scss`, true);
      }
    };

    // Transpile down for the ES module high-water mark. This is the `type="module"` import above.
    const {code: transpiledForES} = await babel.transformAsync(code, {
      filename,
      presets: [
        ['@babel/preset-env', {
          targets: {esmodules: true},
        }],
      ],
      plugins: [
        // include _style replacements as a byproduct
        buildTemplateTagReplacer(templateTagReplacer),
      ],
      sourceType: 'module',
    });
    const minifiedForES = terser.minify(transpiledForES);
    await write(path.join('dist/static/src', filename), minifiedForES.code);
    totalSizeES += minifiedForES.code.length;
  }
  log(`Written ${color.cyan(totalSizeES)} bytes of ES module code`);

  // Generate ES5 versions of entrypoints.
  const babelPlugin = require('rollup-plugin-babel');
  for (const [filename, data] of entrypoints) {
    console.info('entrypoint', filename);

    // TODO(samthor): fast-async adds boilerplate to all files, should be included with polyfills
    // https://github.com/MatAtBread/fast-async#runtimepattern
    const bundle = await rollup.rollup({
      plugins: [
        babelPlugin({
          plugins: [
            // TODO(samthor): Grab _msg use here and pass to entrypoints.
            'module:fast-async',  // use fast-async over transform-regenerator
          ],
          presets: [
            ['@babel/preset-env', {
              targets: {browsers: 'ie >= 11'},
              exclude: ['transform-regenerator'],
            }],
          ],
        }),
      ],
      input: path.join('dist/static/src', filename),
    });
    const generated = await bundle.generate({format: 'es'});
    await write(path.join('dist/static/src', `_${filename}`), generated.code);
  }

  // Display information about missing messages.
  const missingMessagesKeys = Object.keys(missingMessages);
  if (missingMessagesKeys.length) {
    log(`Missing ${color.red(missingMessagesKeys.length)} messages:`);
    missingMessagesKeys.forEach((msgid) => {
      const missingLangs = missingMessages[msgid];
      const ratio = (missingLangs.size / Object.keys(langs).length * 100).toFixed() + '%';
      const rest = (missingLangs.size <= 10) ? `[${[...missingLangs]}]` : '';
      console.info(color.yellow(msgid), 'for', color.red(ratio), 'of langs', rest);
    });
  }

  log(`Done!`);
}

release().catch((err) => {
  console.warn(err);
  process.exit(1);
});
