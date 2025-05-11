
import { GraphQLClient } from "graphql-request";
import { OrderResponse } from "../types";
import GET_USER_ACTIVE_ORDERS from "../graphql/getUserActiveOrders";
 

export const getUserActiveOrders = async (user: String, chainId: number, poolId: String) => {
  const client = getSubGraphClient();
  try {
    const current_timestamp = Date.now() / 1000
    const response = (
      await client.request<{ orderss: { items: OrderResponse[]} }>(GET_USER_ACTIVE_ORDERS , { current_timestamp, user, chainId, poolId})
    ).orderss.items;
    return response;
  } catch (error) {
    console.error("Error fetching deposits:", error);
    return [];
  }
};

export const getSubGraphClient = () => {
  const client = new GraphQLClient(process.env.INDEXER_URL as string);
  return client;
};
