import { runtimeAgentsApi as agentsApi } from "@/features/agents/AgentsRuntime";
import { globalMistyError } from "@/features/global-search/globalMistyActions";
import { globalMistyApi } from "@/features/global-search/globalMistyApi";
import type { GlobalSearchState } from "@/features/global-search/globalSearchState";
import {
  findProposal,
  patchProposal,
  type GlobalSearchGet,
  type GlobalSearchSet,
} from "@/features/global-search/globalSearchStoreHelpers";
import { assertMistyAvailable } from "./availability";

/** Approving, rejecting and canceling the actions and agent runs Misty proposes. */
export function createMistyProposalActions(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
): Pick<
  GlobalSearchState,
  "submitAgentTask" | "cancelAgentTask" | "approveAgentTask" | "confirmAction" | "rejectAction"
> {
  return {
    submitAgentTask: async (prompt, _paneId, presentation = "panel") =>
      get().submitAnswer(prompt, [], undefined, presentation),
    cancelAgentTask: async (proposalId) => {
      const proposal = findProposal(get().conversations, proposalId);
      if (!proposal?.runId) return;
      try {
        if (proposal.approvalId) {
          await agentsApi.decideApproval(proposal.runId, proposal.approvalId, "deny");
        } else {
          await agentsApi.cancelRun(proposal.runId);
        }
        patchProposal(set, get, proposalId, {
          state: "rejected",
          error: undefined,
        });
      } catch (error) {
        patchProposal(set, get, proposalId, {
          error: globalMistyError(error),
        });
      }
    },
    approveAgentTask: async (proposalId) => {
      const proposal = findProposal(get().conversations, proposalId);
      if (!proposal?.runId || !proposal.approvalId) return;
      try {
        await agentsApi.decideApproval(proposal.runId, proposal.approvalId, "approve");
        patchProposal(set, get, proposalId, {
          state: "running",
          approvalId: undefined,
          error: undefined,
        });
      } catch (error) {
        patchProposal(set, get, proposalId, {
          error: globalMistyError(error),
        });
      }
    },
    confirmAction: async (proposalId) => {
      const located = findProposal(get().conversations, proposalId);
      if (!located) return;
      patchProposal(set, get, proposalId, {
        state: "running",
        error: undefined,
      });
      set({
        working: true,
        error: null,
      });
      try {
        await assertMistyAvailable(get().accountId, located.spaceId || get().selectedSpaceId || "");
        if (located.runId && located.approvalId) {
          await agentsApi.decideApproval(located.runId, located.approvalId, "approve");
          patchProposal(set, get, proposalId, {
            state: "running",
          });
        } else {
          const completed = await globalMistyApi.decideProposal(proposalId, true);
          patchProposal(set, get, proposalId, completed);
        }
      } catch (error) {
        patchProposal(set, get, proposalId, {
          state: "failed",
          error: globalMistyError(error),
        });
      } finally {
        set({
          working: false,
        });
      }
    },
    rejectAction: (proposalId) => {
      const located = findProposal(get().conversations, proposalId);
      patchProposal(set, get, proposalId, {
        state: "rejected",
      });
      if (located?.runId && located?.approvalId) {
        void agentsApi
          .decideApproval(located.runId, located.approvalId, "deny")
          .catch(() => undefined);
      } else {
        void globalMistyApi.decideProposal(proposalId, false).catch(() => undefined);
      }
    },
  };
}
