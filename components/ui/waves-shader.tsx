"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";

export function ShaderComponent({ className }: Readonly<{ className?: string }>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let camera: THREE.Camera;
    let scene: THREE.Scene;
    let renderer: THREE.WebGLRenderer;
    let animationFrame = 0;
    let uniforms: { [key: string]: THREE.IUniform };
    const container = containerRef.current;

    const init = () => {
      const startTime = performance.now();
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

      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
      renderer.domElement.style.position = "absolute";
      renderer.domElement.style.inset = "0";
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.zIndex = "0";
      container.appendChild(renderer.domElement);

      const onWindowResize = () => {
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;
        renderer.setSize(width, height, false);
        uniforms.u_resolution.value.x = renderer.domElement.width;
        uniforms.u_resolution.value.y = renderer.domElement.height;
      };

      window.addEventListener("resize", onWindowResize);
      onWindowResize();

      const animate = () => {
        uniforms.u_time.value = (performance.now() - startTime) / 1000;
        renderer.render(scene, camera);
        animationFrame = requestAnimationFrame(animate);
      };

      animate();

      return () => {
        window.removeEventListener("resize", onWindowResize);
        cancelAnimationFrame(animationFrame);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    };

    try {
      setWebglFailed(false);
      return init();
    } catch (error) {
      console.warn("Waves shader WebGL initialization failed; using CSS fallback.", error);
      setWebglFailed(true);
      return undefined;
    }
  }, []);

  return (
    <div ref={containerRef} className={cn("relative h-screen w-full overflow-hidden", className)}>
      <div
        data-waves-fallback
        className={cn(
          "pointer-events-none absolute inset-0 z-10 bg-[conic-gradient(from_225deg_at_52%_48%,rgba(18,24,50,0.34),rgba(118,104,255,0.34),rgba(20,184,166,0.22),rgba(255,145,77,0.22),rgba(18,24,50,0.34)),linear-gradient(115deg,rgba(18,24,50,0.30),rgba(255,255,255,0.55)_24%,rgba(86,97,216,0.22)_48%,rgba(255,255,255,0.62)_72%,rgba(255,107,74,0.16)),repeating-linear-gradient(135deg,rgba(86,97,216,0.13)_0px,rgba(86,97,216,0.13)_1px,transparent_1px,transparent_18px)] mix-blend-multiply",
          webglFailed ? "opacity-100" : "opacity-80"
        )}
      />
    </div>
  );
}
