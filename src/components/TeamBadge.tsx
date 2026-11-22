import type { TeamRef } from "@/types/sports";
import { cn, initials } from "@/lib/utils";

interface TeamBadgeProps {
  team: TeamRef;
  size?: "sm" | "md" | "lg";
  className?: string;
}

function isLightColor(hex: string): boolean {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return false;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.64;
}

const SIZES = {
  sm: "h-7 w-7 rounded-lg text-[9px]",
  md: "h-10 w-10 rounded-xl text-[11px]",
  lg: "h-14 w-14 rounded-2xl text-sm",
} as const;

export function TeamBadge({ team, size = "md", className }: TeamBadgeProps) {
  const light = isLightColor(team.color);

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/20 font-extrabold tracking-tight shadow-sm ring-1 ring-black/5",
        SIZES[size],
        className,
      )}
      style={{
        backgroundColor: team.color,
        color: light ? "#0f172a" : "#ffffff",
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.14), 0 8px 22px -14px ${team.color}`,
      }}
      aria-hidden="true"
    >
      <span
        className="absolute inset-x-0 bottom-0 h-[22%] opacity-90"
        style={{ backgroundColor: team.secondaryColor }}
      />
      <span className="relative z-[1]">{initials(team.shortName || team.name)}</span>
    </span>
  );
}
