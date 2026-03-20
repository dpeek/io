import {
  entityReferenceComboboxEditorKind,
  existingEntityReferenceField,
} from "../../../graph/reference-policy.js";
import { icon } from "./type.js";

export function iconReferenceField(label = "Icon") {
  return existingEntityReferenceField(icon, {
    cardinality: "one?",
    editorKind: entityReferenceComboboxEditorKind,
    label,
  });
}
