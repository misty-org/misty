import { createElement, lazy, Suspense, type ComponentType } from "react";

export function lazyPart<Props extends object>(
  load: () => Promise<ComponentType<Props>>,
): ComponentType<Props> {
  const Part = lazy(() => load().then((component) => ({ default: component })));
  // eslint-disable-next-line shared-ui/no-nested-component -- one component per part, made once at module level
  function LazyPart(props: Props) {
    return (
      <Suspense fallback={null}>{createElement(Part as ComponentType<Props>, props)}</Suspense>
    );
  }
  return LazyPart;
}
