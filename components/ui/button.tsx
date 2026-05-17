import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-[#151922] text-white shadow-[0_18px_46px_rgba(20,25,34,0.18)] hover:-translate-y-0.5 hover:bg-[#252b37]",
        secondary: "bg-white text-[#171b24] shadow-[0_12px_34px_rgba(20,25,34,0.08)] ring-1 ring-black/[0.06] hover:-translate-y-0.5 hover:bg-[#fbfbfd]",
        ghost: "text-[#626a78] hover:bg-black/[0.04] hover:text-[#171b24]",
        outline: "border border-black/[0.08] bg-white/45 text-[#171b24] shadow-sm backdrop-blur hover:-translate-y-0.5 hover:bg-white"
      },
      size: {
        default: "h-11 px-5 py-2",
        sm: "h-9 px-4",
        lg: "h-12 px-6 py-3 text-base",
        icon: "h-10 w-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
