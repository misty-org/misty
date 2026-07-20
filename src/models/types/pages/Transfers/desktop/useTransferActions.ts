import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";
import { useOperationQueueStore } from "@/stores/explorer";
import { useTransfersStore } from "@/stores/transfers";
import { isLiveTransfer } from "@/pages/Transfers/desktop/transferModel";

export type TransferActionFeedback = {
  tone: "busy" | "success" | "error";
  text: string;
} | null;
