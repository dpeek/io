import { defineValidatedStringTypeModule } from "../../../type/validated-string.js";
import { emailFilter } from "./filter.js";
import { emailAddressLabel, parseEmail } from "./parse.js";

export const emailTypeModule = defineValidatedStringTypeModule({
  values: { key: "core:email", name: "Email" },
  parse: parseEmail,
  filter: emailFilter,
  placeholder: emailAddressLabel,
  inputType: "email",
  inputMode: "email",
  autocomplete: "email",
});

export const emailType = emailTypeModule.type;
