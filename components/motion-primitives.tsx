"use client";

import { animate, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export function PageTransition({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Reveal({
  children,
  delay = 0,
  className
}: Readonly<{ children: ReactNode; delay?: number; className?: string }>) {
  return (
    <motion.div
      className={className}
      initial={false}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.72, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Stagger({
  children,
  className
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <motion.div
      className={className}
      initial={false}
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.09 } }
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <motion.div
      className={className}
      initial={false}
      variants={{
        hidden: { opacity: 0, y: 18, filter: "blur(10px)" },
        show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.58, ease: [0.22, 1, 0.36, 1] } }
      }}
    >
      {children}
    </motion.div>
  );
}

export function FloatingOrbs() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <motion.div
        className="soft-orb absolute left-[8%] top-[8%] h-72 w-72 rounded-full bg-[#d9e3ff]"
        animate={{ x: [0, 24, -12, 0], y: [0, 16, 38, 0], scale: [1, 1.08, 0.98, 1] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="soft-orb absolute right-[10%] top-[18%] h-80 w-80 rounded-full bg-[#eadfff]"
        animate={{ x: [0, -28, 18, 0], y: [0, 34, -10, 0], scale: [1, 0.94, 1.06, 1] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="soft-orb absolute bottom-[6%] left-[38%] h-72 w-72 rounded-full bg-[#d8f1ef]"
        animate={{ x: [0, 22, -30, 0], y: [0, -18, 22, 0], scale: [1, 1.05, 0.96, 1] }}
        transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="noise absolute inset-0 opacity-[0.035]" />
    </div>
  );
}

export function TiltPanel({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const smoothX = useSpring(x, { stiffness: 120, damping: 18 });
  const smoothY = useSpring(y, { stiffness: 120, damping: 18 });
  const rotateX = useTransform(smoothY, [-0.5, 0.5], [5, -5]);
  const rotateY = useTransform(smoothX, [-0.5, 0.5], [-5, 5]);

  return (
    <motion.div
      className={className}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        x.set((event.clientX - rect.left) / rect.width - 0.5);
        y.set((event.clientY - rect.top) / rect.height - 0.5);
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedCounter({ value, suffix = "" }: Readonly<{ value: number; suffix?: string }>) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(0, value, {
      duration: 1.2,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(Math.round(latest))
    });
    return () => controls.stop();
  }, [value]);

  return (
    <motion.span
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
    >
      {display}
      {suffix}
    </motion.span>
  );
}
