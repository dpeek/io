import { type QueryResultPage, type SerializedQueryRequest } from "@io/core/graph";
import {
  defaultHttpSerializedQueryPath,
  HttpSerializedQueryClientError,
  requestSerializedQuery,
  type HttpSerializedQueryClientOptions,
} from "@io/core/graph/runtime";

export const webSerializedQueryPath = defaultHttpSerializedQueryPath;

export type SerializedQueryClientOptions = HttpSerializedQueryClientOptions;
export type SerializedQueryResultPage = QueryResultPage;
export type WebSerializedQueryRequest = SerializedQueryRequest;

export { HttpSerializedQueryClientError as SerializedQueryClientError };
export { requestSerializedQuery };
