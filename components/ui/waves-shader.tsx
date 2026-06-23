"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";

type ShaderSizing = "viewport" | "element";

type ShaderComponentProps = {
  className?: string;
  sizing?: ShaderSizing;
  pixelRatioCap?: number;
  pauseWhenOffscreen?: boolean;
  intersectionMargin?: string;
};

export function ShaderComponent({
  className,
  sizing = "element",
  pixelRatioCap = 1.25,
  pauseWhenOffscreen = false,
  intersectionMargin = "240px"
}: Readonly<ShaderComponentProps>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let camera: THREE.Camera;
    let scene: THREE.Scene;
    let renderer: THREE.WebGLRenderer;
    let animationFrame = 0;
    let resizeFrame = 0;
    let uniforms: { [key: string]: THREE.IUniform };
    let resizeObserver: ResizeObserver | undefined;
    let intersectionObserver: IntersectionObserver | undefined;
    let isIntersecting = !pauseWhenOffscreen;
    let isDocumentVisible = !document.hidden;
    let elapsedTime = 0;
    let lastFrameTime: number | undefined;
    const container = containerRef.current;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const prefersReducedMotion = motionQuery.matches;

    const init = () => {
      camera = new THREE.Camera();
      camera.position.z = 1;

      scene = new THREE.Scene();
      const geometry = new THREE.PlaneGeometry(2, 2);

      uniforms = {
        u_time: { value: 1.0 },
        u_resolution: { value: new THREE.Vector2() }
      };

      const vertexShader = `
        varying vec2 vUv;
        void main() {
          gl_Position = vec4(position, 1.0);
          vUv = uv;
        }
      `;

      const fragmentShader = `
        precision highp float;

        uniform vec2 u_resolution;
        uniform float u_time;
        varying vec2 vUv;

        const float PI = 3.1415926535897932384626433832795;
        const float TAU = PI * 2.;

        void coswarp(inout vec3 trip, float warpsScale ){
          trip.xyz += warpsScale * .1 * cos(3. * trip.yzx + (u_time * .25));
          trip.xyz += warpsScale * .05 * cos(11. * trip.yzx + (u_time * .25));
          trip.xyz += warpsScale * .025 * cos(17. * trip.yzx + (u_time * .25));
        }

        void main() {
          vec2 uv = (gl_FragCoord.xy - u_resolution * .5) / u_resolution.yy + 0.5;

          float t = (u_time *.2) + length(fract((uv-.5) *10.));
          float t2 = (u_time *.1) + length(fract((uv-.5) *20.));

          vec2 uv2 = uv;
          vec3 w = vec3(uv.x, uv.y, 1.);
          coswarp(w, 3.);

          uv.x+= w.r;
          uv.y+= w.g;

          vec3 color = vec3(0., .5, uv2.x);
          color.r = sin(u_time *.2) + sin(length(uv-.5) * 10.);
          color.g = sin(u_time *.3) + sin(length(uv-.5) * 20.);

          coswarp(color, 3.);

          float wave = smoothstep(color.r, sin(t2), sin(t));
          float diagonal = smoothstep(-0.35, 0.9, uv2.x - uv2.y + 0.24 * sin(u_time * .18));
          float pulse = 0.5 + 0.5 * sin(u_time * .16 + uv2.x * 7.0 + uv2.y * 4.0);
          float lavenderBand = smoothstep(-0.18, 0.92, uv2.x + uv2.y - 0.54 + 0.12 * sin(u_time * .13));
          float emberBand = smoothstep(0.16, 1.08, (1.0 - uv2.x) * 0.72 + uv2.y + 0.10 * cos(u_time * .17));

          vec3 ink = vec3(0.10, 0.14, 0.29);
          vec3 indigo = vec3(0.30, 0.34, 0.86);
          vec3 lavender = vec3(0.74, 0.72, 1.0);
          vec3 ice = vec3(0.90, 0.96, 1.0);
          vec3 mint = vec3(0.08, 0.72, 0.66);
          vec3 amber = vec3(1.0, 0.58, 0.28);

          color = mix(ink, ice, wave);
          color = mix(color, indigo, 0.22 * diagonal + 0.08 * pulse);
          color = mix(color, lavender, 0.18 * lavenderBand * (1.0 - diagonal));
          color = mix(color, mint, 0.12 * wave * (1.0 - diagonal));
          color = mix(color, amber, 0.10 * emberBand * (1.0 - wave));
          color *= 0.92 + 0.18 * pulse;

          gl_FragColor = vec4(color, 1.0);
        }
      `;

      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader
      });

      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        depth: false,
        stencil: false,
        powerPreference: "high-performance"
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
      renderer.domElement.style.position = "absolute";
      renderer.domElement.style.inset = "0";
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.zIndex = "0";
      renderer.domElement.dataset.shaderCanvas = sizing;
      container.appendChild(renderer.domElement);

      const getRenderSize = () => {
        if (sizing === "viewport") {
          return {
            width: Math.max(1, Math.round(window.visualViewport?.width ?? window.innerWidth)),
            height: Math.max(1, Math.round(window.visualViewport?.height ?? window.innerHeight))
          };
        }

        const bounds = container.getBoundingClientRect();
        return {
          width: Math.max(1, Math.round(bounds.width || container.clientWidth)),
          height: Math.max(1, Math.round(bounds.height || container.clientHeight))
        };
      };

      const resizeRenderer = () => {
        resizeFrame = 0;
        const { width, height } = getRenderSize();
        renderer.setSize(width, height, false);
        renderer.getDrawingBufferSize(uniforms.u_resolution.value);
        container.dataset.shaderSize = `${width}x${height}`;
      };

      const scheduleResize = () => {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(resizeRenderer);
      };

      const animate = (now: number) => {
        if (lastFrameTime !== undefined) {
          elapsedTime += (now - lastFrameTime) / 1000;
        }
        lastFrameTime = now;
        uniforms.u_time.value = elapsedTime;
        renderer.render(scene, camera);
        animationFrame = requestAnimationFrame(animate);
      };

      const shouldAnimate = () =>
        !prefersReducedMotion &&
        isDocumentVisible &&
        (!pauseWhenOffscreen || isIntersecting);

      const stopAnimation = () => {
        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }
        lastFrameTime = undefined;
        container.dataset.shaderActive = "false";
      };

      const updateAnimation = () => {
        if (shouldAnimate()) {
          if (!animationFrame) {
            container.dataset.shaderActive = "true";
            animationFrame = requestAnimationFrame(animate);
          }
          return;
        }
        stopAnimation();
      };

      const onVisibilityChange = () => {
        isDocumentVisible = !document.hidden;
        updateAnimation();
      };

      window.addEventListener("resize", scheduleResize);
      window.visualViewport?.addEventListener("resize", scheduleResize);
      document.addEventListener("visibilitychange", onVisibilityChange);

      resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(container);

      if (pauseWhenOffscreen) {
        intersectionObserver = new IntersectionObserver(
          ([entry]) => {
            isIntersecting = entry.isIntersecting;
            updateAnimation();
          },
          { rootMargin: intersectionMargin }
        );
        intersectionObserver.observe(container);
      }

      resizeRenderer();
      renderer.render(scene, camera);
      updateAnimation();

      return () => {
        window.removeEventListener("resize", scheduleResize);
        window.visualViewport?.removeEventListener("resize", scheduleResize);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        resizeObserver?.disconnect();
        intersectionObserver?.disconnect();
        stopAnimation();
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    };

    try {
      setReducedMotion(prefersReducedMotion);
      setWebglFailed(false);
      return init();
    } catch (error) {
      console.warn("Waves shader WebGL initialization failed; using CSS fallback.", error);
      setWebglFailed(true);
      return undefined;
    }
  }, [intersectionMargin, pauseWhenOffscreen, pixelRatioCap, sizing]);

  return (
    <div
      ref={containerRef}
      data-shader-sizing={sizing}
      className={cn("relative w-full overflow-hidden [contain:strict]", sizing === "viewport" ? "h-[100dvh]" : "h-full", className)}
      style={sizing === "viewport" ? { width: "100vw", height: "100dvh" } : undefined}
    >
      <div
        data-waves-fallback
        className={cn(
          "pointer-events-none absolute inset-0 z-10 bg-[conic-gradient(from_225deg_at_52%_48%,rgba(18,24,50,0.34),rgba(118,104,255,0.34),rgba(20,184,166,0.22),rgba(255,145,77,0.22),rgba(18,24,50,0.34)),linear-gradient(115deg,rgba(18,24,50,0.30),rgba(255,255,255,0.55)_24%,rgba(86,97,216,0.22)_48%,rgba(255,255,255,0.62)_72%,rgba(255,107,74,0.16)),repeating-linear-gradient(135deg,rgba(86,97,216,0.13)_0px,rgba(86,97,216,0.13)_1px,transparent_1px,transparent_18px)] mix-blend-multiply",
          webglFailed || reducedMotion ? "opacity-100" : "opacity-80"
        )}
      />
    </div>
  );
}
