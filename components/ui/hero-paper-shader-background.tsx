"use client";

import { Canvas } from "@react-three/fiber";
import { EnergyRing, ShaderPlane } from "@/components/ui/background-paper-shaders";

export function HeroPaperShaderBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(224,231,255,0.72),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.92)_86%)]" />
      <Canvas
        camera={{ position: [0, 0, 5.4], fov: 44 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        className="h-full w-full opacity-55"
      >
        <ambientLight intensity={0.6} />
        <ShaderPlane position={[-1.55, 0.68, 0]} color1="#c7d2fe" color2="#ffffff" />
        <ShaderPlane position={[1.45, 0.15, -0.15]} color1="#e9d5ff" color2="#f8fafc" />
        <ShaderPlane position={[0.15, -0.92, -0.35]} color1="#bfdbfe" color2="#ffffff" />
        <EnergyRing radius={0.72} position={[1.05, 0.62, 0.18]} color="#c7d2fe" />
      </Canvas>
      <div className="absolute inset-0 bg-white/42 backdrop-blur-[1px]" />
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-b from-transparent via-white/82 to-white" />
    </div>
  );
}
