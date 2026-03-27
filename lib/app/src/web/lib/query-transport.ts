import {
  type QueryResultPage,
  type SerializedQueryRequest,
  defaultHttpSerializedQueryPath,
  HttpSerializedQueryClientError,
  requestSerializedQuery,
  type HttpSerializedQueryClientOptions,
} from "@io/graph-client";

export const webSerializedQueryPath = defaultHttpSerializedQueryPath;

export type SerializedQueryClientOptions = HttpSerializedQueryClientOptions;
export type SerializedQueryResultPage = QueryResultPage;
export type WebSerializedQueryRequest = SerializedQueryRequest;

export { HttpSerializedQueryClientError as SerializedQueryClientError };
export { requestSerializedQuery };
