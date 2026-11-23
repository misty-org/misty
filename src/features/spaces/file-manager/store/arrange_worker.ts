import { arrangeOrder, type ArrangeAsk, type ArrangeRow } from "./arrange_rules";

interface Ask {
  seq: number;
  rows: ArrangeRow[];
  ask: ArrangeAsk;
}

self.onmessage = (event: MessageEvent<Ask>) => {
  const { seq, rows, ask } = event.data;
  self.postMessage({ seq, order: arrangeOrder(rows, ask) });
};
