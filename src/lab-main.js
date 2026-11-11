import { mountLab } from "./lab.js";
import { createRunStorage } from "./storage.js";

const byId = id => document.getElementById(id);
const storage = createRunStorage(document.querySelector('meta[name="mini-react-run"]')?.content);
mountLab({
  actual: byId("actual"), preview: byId("preview"), editor: byId("markup"),
  patchButton: byId("apply-patch"), back: byId("history-back"), forward: byId("history-forward"),
  position: byId("history-position"), changes: byId("patch-summary"), storage,
});
