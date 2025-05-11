import { gql } from 'graphql-request'
const GET_USER_ACTIVE_ORDERS = gql`
  query getActiveOrder($current_time: Int, $user: String) {
    orderss(where: { status: "OPEN", expiry_gte: $current_time, user: $user }) {
      items {
        side
        quantity
        price
        id: orderId
        expiry
        type
      }
    }
  }
`

export default GET_USER_ACTIVE_ORDERS
