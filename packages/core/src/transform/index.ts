export { type Mappable, Mapping, type MapResult, StepMap } from "./stepmap.js";
export {
  AddMarkStep,
  NodeMarkupBatchStep,
  NodeMarkupStep,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  Step,
  StepResult,
} from "./steps.js";
export {
  canJoin,
  canSplit,
  findWrapping,
  liftTarget,
  type NodeTypeWithAttrs,
} from "./structure.js";
export { Transform, TransformError } from "./transform.js";
