import { gql } from 'graphql-request'
const GET_USER_ACTIVE_ORDERS = gql`
  query getActiveOrder($currentTime: Int, $user: String, $chainId: Int, $poolId: String) {
    orderss(
      where: {
        AND: [
          { OR: [{ status: "OPEN" }, { status: "PARTIALLY_FILLED" }] }
          { user: $user }
          { chainId: $chainId }
          { expiry_gte: $currentTime }
          { poolId: $poolId }
        ]
      }
    ) {
      items {
        side
        quantity
        price
        id: orderId
        expiry
        type
        poolId
      }
    }
  }
`

export default GET_USER_ACTIVE_ORDERS
