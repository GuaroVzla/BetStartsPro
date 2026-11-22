import { CircleDot, Dribbble, Goal, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SportKey } from "@/types/sports";
import { cn } from "@/lib/utils";

const ICONS: Record<SportKey, LucideIcon> = {
  soccer: Goal,
  basketball: Dribbble,
  baseball: CircleDot,
  hockey: Zap,
};

interface SportIconProps {
  sport: SportKey;
  className?: string;
  strokeWidth?: number;
}

export function SportIcon({ sport, className, strokeWidth = 1.8 }: SportIconProps) {
  const Icon = ICONS[sport];
  return <Icon className={cn("h-4 w-4", className)} strokeWidth={strokeWidth} />;
}
