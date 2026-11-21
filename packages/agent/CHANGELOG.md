# @folijs/agent

## 0.1.0

### Minor Changes

- First release. An LLM agent reads and edits a document without computing positions: `openSession(document, { author })` gives the body as text with a handle per block (`read`), and operations that take handles (`replaceText`, `insertAfter`, `insertBefore`, `deleteBlock`, `setStyle`, `comment`, `controls`, `fillControl`, `updateFields`). Every edit is a tracked change in the author's name, for a person to accept or reject in Foli or in Word. Results are values: the blocks as they read now, or a refusal with a code and a message written for the model. No DOM and no Node built-ins. Unstable (0.x): outside the 1.0 promise of the other packages.
