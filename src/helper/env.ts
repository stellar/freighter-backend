export type mode = "development" | "production";

export const isValidMode = (str: string) => {
  return str === "development" || str === "production";
};
