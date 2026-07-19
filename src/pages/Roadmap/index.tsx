import { HiOutlineCheck } from "react-icons/hi2";
import { VscCircleFilled } from "react-icons/vsc";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { phases } from "./data";

const statusStyles = {
  done: {
    badgeVariant: "secondary" as const,
    icon: <HiOutlineCheck className="w-3.5 h-3.5 text-success" />,
  },
  active: {
    badgeVariant: "default" as const,
    icon: <VscCircleFilled className="w-3 h-3 text-primary animate-pulse" />,
  },
  planned: {
    badgeVariant: "outline" as const,
    icon: <VscCircleFilled className="h-3 w-3 text-muted-foreground" />,
  },
};

export default function Roadmap() {
  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-32 pb-20">
      <div className="mb-12">
        <h1 className="mb-4 text-3xl font-bold text-foreground md:text-5xl">
          Roadmap
        </h1>
        <p className="leading-relaxed text-muted-foreground">
          Where Misty is headed. Features move from planned to shipped as
          development progresses.
        </p>
      </div>

      <div className="flex flex-col gap-10">
        {phases.map((phase) => {
          const style = statusStyles[phase.status];
          return (
            <div key={phase.label}>
              <div className="flex items-center gap-3 mb-4">
                <Badge variant={style.badgeVariant}>
                  {phase.label}
                </Badge>
              </div>
              <div className="flex flex-col gap-2">
                {phase.items.map((item) => (
                  <Card
                    key={item}
                    size="sm"
                    className="flex-row items-center gap-3 rounded-lg px-4 py-3"
                  >
                    {style.icon}
                    <span className="text-sm text-foreground">{item}</span>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
