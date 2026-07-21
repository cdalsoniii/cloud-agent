import {
  envValidationTool,
  opencodeLoopTool,
  sdlcBatchTool,
  mastraOrchestrateTool,
  daytonaCreateTool,
} from '../src/mastra/tools/daytona-tools.ts';

const results = {
  env: await envValidationTool.execute({ context: {} }),
  createDry: await daytonaCreateTool.execute({ context: { dryRun: true } }),
  loopDry: await opencodeLoopTool.execute({
    context: { dryRun: true, workItem: 'factory-item-02' },
  }),
  sdlcDry: await sdlcBatchTool.execute({
    context: { dryRun: true, jobsFile: 'jobs-brightforest-meta.json' },
  }),
  orchDry: await mastraOrchestrateTool.execute({
    context: { dryRun: true, task: 'echo smoke' },
  }),
};

console.log(JSON.stringify(results, null, 2));
