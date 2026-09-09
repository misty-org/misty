import { apiRequest } from "@/api/client";
import { createAgentsApi } from "./api-core";

export const agentsApi = createAgentsApi(apiRequest);
