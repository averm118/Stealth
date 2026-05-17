import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-full border border-black/[0.07] bg-white/75 px-4 text-sm text-[#171b24] shadow-sm outline-none transition placeholder:text-[#9aa1ad] focus:border-[#9caaff] focus:ring-4 focus:ring-[#9caaff]/15",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
