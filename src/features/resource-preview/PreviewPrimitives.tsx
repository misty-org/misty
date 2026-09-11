export function PreviewMessage(props: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[520px] place-items-center p-8 text-center">
      <div className="grid max-w-md justify-items-center gap-3 text-cream-muted">
        {props.icon}
        <strong className="text-base text-cream">{props.title}</strong>
        <p className="m-0 text-sm leading-6">{props.detail}</p>
        {props.action}
      </div>
    </div>
  );
}
