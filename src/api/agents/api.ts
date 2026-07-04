import { apiRequest, apiBlobRequest } from "@/api/client";
import { createAgentsApi } from "./api-core";

export const agentsApi = createAgentsApi(apiRequest, apiBlobRequest);
