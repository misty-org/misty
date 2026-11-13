import { Text } from "@/shared/ui";

export function PreviewMessage(props: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-130 place-items-center p-8 text-center">
      <Text bare as="div" tone="muted" className="grid max-w-md justify-items-center gap-3">
        {props.icon}
        <strong className="text-base">
          <Text bare tone="default">
            {props.title}
          </Text>
        </strong>
        <p className="m-0 text-sm leading-6">{props.detail}</p>
        {props.action}
      </Text>
    </div>
  );
}
