import { mountLab } from "./lab.js";
import { mountBoard } from "./demo.js";

const byId = id => document.getElementById(id);

mountLab({
  actual: byId("actual"), preview: byId("preview"), editor: byId("markup"),
  patchButton: byId("apply-patch"), back: byId("history-back"), forward: byId("history-forward"),
  position: byId("history-position"), changes: byId("patch-summary"),
});
mountBoard(byId("board"));
