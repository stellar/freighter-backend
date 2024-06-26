import axios from "axios";
import { Logger } from "pino";

enum ResponseType {
  MATRIX = "matrix",
  VECTOR = "vector",
  SCALAR = "scalar",
  STRING = "string",
}

interface PromRangeQueryParams {
  [index: string]: string;
  query: string;
  start: string;
  end: string;
}

interface PromResponse {
  resultType: ResponseType;
  result: unknown;
}

export class PrometheusQuery {
  prometheusUrl: string;
  logger: Logger;

  constructor(prometheusUrl: string, logger: Logger) {
    this.prometheusUrl = prometheusUrl;
    this.logger = logger;
  }

  queryRange = async (params: PromRangeQueryParams) => {
    try {
      const search = new URLSearchParams(params);
      const response: PromResponse = await axios.get(
        `${this.prometheusUrl}/range_query?${search.toString()}`
      );
      return response;
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  };
}
