/**
 * Admin API 2026-10.
 * fulfillmentTrackingInfoUpdate changes tracking on an existing fulfillment.
 * It does not adjust inventory quantities.
 * Creating a fulfillment is intentionally absent: that marks line items
 * fulfilled and can change on-hand inventory.
 */

export const TRACKING_ORDER_QUERY = `#graphql
  query TrackingOrderBySearch($query: String!) {
    orders(first: 5, query: $query) {
      nodes {
        id
        name
        displayFinancialStatus
        fulfillments(first: 10) {
          id
          status
          createdAt
          trackingInfo {
            company
            number
            url
          }
        }
      }
    }
  }
`;

/**
 * Read-only. Sums the available quantity across inventory levels.
 * No inventory mutation is defined in this file.
 */
export const VARIANT_INVENTORY_QUERY = `#graphql
  query VariantInventoryBySku($query: String!) {
    productVariants(first: 50, query: $query) {
      nodes {
        id
        sku
        inventoryItem {
          tracked
          inventoryLevels(first: 20) {
            nodes {
              location {
                name
              }
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

export const TRACKING_INFO_UPDATE = `#graphql
  mutation TrackingInfoUpdate(
    $fulfillmentId: ID!
    $trackingInfoInput: FulfillmentTrackingInput!
    $notifyCustomer: Boolean
  ) {
    fulfillmentTrackingInfoUpdate(
      fulfillmentId: $fulfillmentId
      trackingInfoInput: $trackingInfoInput
      notifyCustomer: $notifyCustomer
    ) {
      fulfillment {
        id
        status
        trackingInfo {
          company
          number
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;
