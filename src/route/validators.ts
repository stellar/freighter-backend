import Ajv, {
  AnySchemaObject,
  ValidateFunction,
  SchemaValidateFunction,
} from "ajv";
import { ERROR } from "../helper/error";

const ajv = new Ajv({
  removeAdditional: true,
  useDefaults: true,
  coerceTypes: "array",
});

ajv.addKeyword({
  keyword: ["pubKey", "contractId", "validator"],
  compile: (schema: any, parentSchema: AnySchemaObject) => {
    return function validate(data: ValidateFunction) {
      if (typeof schema === "function") {
        const valid = schema(data);
        if (!valid) {
          (validate as SchemaValidateFunction).errors = [
            {
              keyword: "validate",
              message: `: ${data} fails validation`,
              params: { keyword: "validate" },
            },
          ];
        }
        return valid;
      } else if (
        typeof schema === "object" &&
        Array.isArray(schema) &&
        schema.every((f) => typeof f === "function")
      ) {
        const [f, errorMessage] = schema;
        const valid = f(data);
        if (!valid) {
          (validate as SchemaValidateFunction).errors = [
            {
              keyword: "validate",
              message: ": " + errorMessage(schema, parentSchema, data),
              params: { keyword: "validate" },
            },
          ];
        }
        return valid;
      } else {
        throw new Error(ERROR.INVALID_VALIDATOR_DEF);
      }
    };
  },
  errors: true,
});

export { ajv };
