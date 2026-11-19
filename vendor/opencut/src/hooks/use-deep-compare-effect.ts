// Misty: runs an effect when its dependencies change by value, not by reference (in place of the
// `use-deep-compare-effect` package OpenCut uses). Dependencies are plain data.
import { useEffect, useRef, type DependencyList, type EffectCallback } from "react";

export default function useDeepCompareEffect(effect: EffectCallback, deps: DependencyList) {
	const key = JSON.stringify(deps);
	const latest = useRef(effect);
	latest.current = effect;
	// biome-ignore lint/correctness/useExhaustiveDependencies: the dependencies are compared by value.
	useEffect(() => latest.current(), [key]);
}
