import { checkGpuVote } from './gpu-vote';
import type { BrowserCaseModule } from './context';


export const gpuVoteCaseCases = {
  "GPU voting and depth-refined contours respond to subpixel boundaries": async caseContext => {
    checkGpuVote();
  },
} satisfies BrowserCaseModule;
