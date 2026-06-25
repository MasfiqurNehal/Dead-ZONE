import {
  WebGLRenderer,
  PCFSoftShadowMap,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  Vector2,
} from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  VignetteEffect,
  SMAAEffect,
  SMAAPreset,
  BlendFunction,
  KernelSize,
} from 'postprocessing';

/**
 * Wraps the WebGL2 renderer and the optional postprocessing pipeline.
 * The engine owns one Renderer instance and calls render() each frame.
 */
export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} quality  one of QUALITY presets from constants.js
   */
  constructor(canvas, quality) {
    this.quality = quality;
    this.composer = null;
    this.usePost = !!quality.postprocessing;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: quality.antialias && !this.usePost, // SMAA handles AA when post is on
      powerPreference: 'high-performance',
      stencil: false,
      // The composer needs an alpha-less opaque buffer; depth stays on.
    });

    const ratio = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.7;

    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    // Report actual API in use so we can warn if WebGL2 is missing.
    this.isWebGL2 = this.renderer.capabilities.isWebGL2;
  }

  /** Build the postprocessing composer once scene + camera exist. */
  initPostprocessing(scene, camera) {
    if (!this.usePost) return;

    this.composer = new EffectComposer(this.renderer, {
      multisampling: 0,
    });
    this.composer.addPass(new RenderPass(scene, camera));

    const bloom = new BloomEffect({
      intensity: 0.5,
      luminanceThreshold: 0.82,
      luminanceSmoothing: 0.3,
      kernelSize: KernelSize.MEDIUM,
      mipmapBlur: true,
    });

    const vignette = new VignetteEffect({
      offset: 0.55,
      darkness: 0.22,
      blendFunction: BlendFunction.NORMAL,
    });

    const smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });

    this.bloom = bloom;
    this.vignette = vignette;

    this.composer.addPass(new EffectPass(camera, smaa, bloom, vignette));
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  setSize(width, height) {
    this.renderer.setSize(width, height);
    if (this.composer) this.composer.setSize(width, height);
  }

  setPixelRatio(ratio) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio));
  }

  render(scene, camera, dt) {
    if (this.composer) {
      this.composer.render(dt);
    } else {
      this.renderer.render(scene, camera);
    }
  }

  /** Free GPU resources. */
  dispose() {
    this.composer?.dispose();
    this.renderer.dispose();
  }

  get domElement() {
    return this.renderer.domElement;
  }

  get drawCalls() {
    return this.renderer.info.render.calls;
  }
}

export const _scratchSize = new Vector2();
