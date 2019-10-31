import SceneManager from './components/SceneManager/index.js'
import { isTouchDevice } from './helpers.js'

const { Scene, PerspectiveCamera } = self.THREE

class SnowglobeGame {
  static get is() {
    return 'snowglobe-game'
  }

  constructor(element) {
    this.canvas = element.querySelector('#canvas')
    this.openColorsBtn = element.querySelector('[data-open-colors]')
    this.colorObjectBtns = [...element.querySelectorAll('[data-color-object]')]
    this.addShapeBtns = [...element.querySelectorAll('[data-add-shape]')]
    this.rotateObjectBtns = [...element.querySelectorAll('[data-rotate-object]')]
    this.rotateCameraBtns = [...element.querySelectorAll('[data-rotate-camera]')]
    this.zoomBtns = [...element.querySelectorAll('[data-zoom]')]
    this.objectRotateBottomUi = element.querySelector('[object-rotate-bottom-ui]')
    this.objectRotateRightUi = element.querySelector('[object-rotate-right-ui]')
    this.objectToolbarUi = element.querySelector('[object-toolbar-ui]')
    this.objectScaleSlider = element.querySelector('[object-scale-slider]')
    this.sceneManager = new SceneManager(this.canvas)


    this.updateEditToolsPos = this.updateEditToolsPos.bind(this)
    this.enterEditMode = this.enterEditMode.bind(this)
    this.hideEditTools = this.hideEditTools.bind(this)

    this.isTouchDevice = isTouchDevice()

    this.stats = new self.Stats()
    this.stats.showPanel(0) // 0: fps, 1: ms, 2: mb, 3+: custom
    document.body.appendChild(this.stats.dom)

    this.hideEditTools()
    this.events()
    this.render()
  }

  events() {
    // global UI
    this.zoomBtns.forEach(button => {
      button.addEventListener('click', this.sceneManager.zoom)
    })

    this.rotateCameraBtns.forEach(button => {
      button.addEventListener('click', this.sceneManager.rotateCamera)
    })

    this.addShapeBtns.forEach(button => {
      const mouseleaveCallback = e => {
        e.preventDefault()
        const { addShape, shapeMaterial } = button.dataset
        this.sceneManager.addShape(addShape, shapeMaterial)
        button.removeEventListener('mouseleave', mouseleaveCallback, false)
      }

      button.addEventListener('mousedown', e => {
        e.preventDefault()
        button.addEventListener('mouseleave', mouseleaveCallback)
      })
    })

    // object UI
    this.openColorsBtn.addEventListener('click', this.openColors)
    this.objectScaleSlider.addEventListener('input', this.sceneManager.onScaleInput)

    this.colorObjectBtns.forEach(button => {
      button.addEventListener('click', this.sceneManager.colorObject)
    })

    let rotateObjectInterval

    this.rotateObjectBtns.forEach(button => {
      button.addEventListener('click', e => {
        const el = e.currentTarget
        this.sceneManager.rotateObject(el)
        button.classList.add('is-clicked')
      })

      button.addEventListener('mousedown', e => {
        e.preventDefault()
        const el = e.currentTarget
        rotateObjectInterval = setInterval(() => {
          this.sceneManager.rotateObject(el)
          button.classList.add('is-clicked')
        }, 200)
      })

      button.addEventListener('mouseup', e => {
        e.preventDefault()
        clearInterval(rotateObjectInterval)
        setTimeout(() => {
          button.classList.remove('is-clicked')
        }, 200)
      })
    })
    // custom events
    this.sceneManager.addListener('enter_edit', this.enterEditMode)
    this.sceneManager.addListener('leave_edit', this.hideEditTools)
    this.sceneManager.addListener('move_camera', this.updateEditToolsPos)
    this.sceneManager.addListener('scale_object', this.updateEditToolsPos)
  }

  enterEditMode() {
    this.showEditTools()
    const { scaleFactor } = this.sceneManager.activeSubject // get current scale of object
    this.objectScaleSlider.value = scaleFactor * 10
    this.updateEditToolsPos()
  }

  showEditTools() {
    this.objectRotateRightUi.style.display = 'block'
    this.objectRotateBottomUi.style.display = 'block'
    this.objectToolbarUi.style.display = 'block'
  }

  hideEditTools() {
    this.objectRotateRightUi.style.display = 'none'
    this.objectRotateBottomUi.style.display = 'none'
    this.objectToolbarUi.style.display = 'none'
  }

  updateEditToolsPos() {
    const xArrowHelper = this.sceneManager.scene.getObjectByName( 'arrow-helper-x' ) // would be nice if we can store this value somewhere
    const xArrowHelperPos = this.sceneManager.getScreenPosition(xArrowHelper)
    this.objectRotateRightUi.style.transform = `translate(-50%, -50%) translate(${xArrowHelperPos.x}px,${xArrowHelperPos.y}px)`

    const yArrowHelper = this.sceneManager.scene.getObjectByName( 'arrow-helper-y' )
    const yArrowHelperPos = this.sceneManager.getScreenPosition(yArrowHelper)
    this.objectRotateBottomUi.style.transform = `translate(-50%, -50%) translate(${yArrowHelperPos.x}px,${yArrowHelperPos.y}px)`

    const toolbarHelper = this.sceneManager.scene.getObjectByName( 'toolbar-helper' )
    const toolbarHelperPos = this.sceneManager.getScreenPosition(toolbarHelper)
    this.objectToolbarUi.style.transform = `translate(-50%, -50%) translate(${toolbarHelperPos.x}px,${toolbarHelperPos.y}px)`
  }

  openColors(e) {
    const el = e.currentTarget
    el.classList.toggle('is-open')
  }

  onEnterEdit() {
    if (this.sceneManager.activeSubject && this.sceneManager.mode === 'edit') {
      this.objectRotateDownUi.style.display = `block`
      this.objectEditUi.style.display = `block`
      this.objectRotateRightUi.style.display = `block`
      const { scaleFactor } = this.sceneManager.activeSubject // get current scale of object
      this.objectScaleSlider.value = scaleFactor * 10
      this.updateEditToolsPos()
    }
  }

  onMoveCamera() {
    if (this.sceneManager.activeSubject && this.sceneManager.mode === 'edit') {
      this.updateEditToolsPos()
    }
  }

  onScaleObject() {
    if (this.sceneManager.activeSubject && this.sceneManager.mode === 'edit') {
      this.updateEditToolsPos(true)
    }
  }

  onLeaveEdit() {
    this.objectRotateRightUi.style.display = 'none'
    this.objectRotateDownUi.style.display = 'none'
    this.objectEditUi.style.display = 'none'
  }

  updateEditToolsPos(noScaleInput) {
    const rightPosition = this.getPosition('x')
    this.objectRotateRightUi.style.transform = `translate(-50%, -50%) translate(${rightPosition.x}px,${rightPosition.y}px)`

    const downPosition = this.getPosition('y')
    this.objectRotateDownUi.style.transform = `translate(-50%, -50%) translate(${downPosition.x}px,${downPosition.y}px)`

    const scale = this.sceneManager.activeSubject.xCircle.scale.x

    if (!noScaleInput) {
      let ghostPos = new THREE.Vector3()
      this.sceneManager.activeSubject.mesh.getWorldPosition(ghostPos)
      ghostPos.y -= (this.sceneManager.activeSubject.box.max.y - this.sceneManager.activeSubject.box.min.y) / 2
      ghostPos.x += (this.sceneManager.activeSubject.box.max.x - this.sceneManager.activeSubject.box.min.x) / 2
      ghostPos.z += (this.sceneManager.activeSubject.box.max.z - this.sceneManager.activeSubject.box.min.z) / 2
      ghostPos.project(this.sceneManager.cameraCtrl.camera)
      this.objectEditUi.style.transform = `translate(-50%, -50%) translate(${(ghostPos.x * 0.5 + 0.5) *
        this.canvas.clientWidth}px,${(ghostPos.y * -0.5 + 0.5) * this.canvas.clientHeight + 100}px)`
    }
  }

  getPosition(axis) {
    const scale = this.sceneManager.activeSubject.xCircle.scale.x
    const { radius } =
      axis === 'x'
        ? this.sceneManager.activeSubject.xCircle.geometry.boundingSphere
        : this.sceneManager.activeSubject.yCircle.geometry.boundingSphere
    let tempPos = new THREE.Vector3()
    if (this.sceneManager.activeSubject.ghost) {
      this.sceneManager.activeSubject.ghost.getWorldPosition(tempPos)
    } else {
      this.sceneManager.activeSubject.mesh.getWorldPosition(tempPos)
    }
    tempPos[axis] += radius * scale
    tempPos.project(this.sceneManager.cameraCtrl.camera)
    const x = (tempPos.x * 0.5 + 0.5) * this.canvas.clientWidth
    const y = (tempPos.y * -0.5 + 0.5) * this.canvas.clientHeight

    return { x, y }
  }

  setup() {}

  update() {}

  teardown() {}

  start() {}
  resume() {}
}

customElements.define(SnowglobeGame.is, SnowglobeGame)

export default SnowglobeGame
