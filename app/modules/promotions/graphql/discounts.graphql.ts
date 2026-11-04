// One discount, as the Promotions list and the priority order read it.
const LIST_DISCOUNT_NODE = `
  fragment ListDiscountNode on DiscountNode {
        id

        events(first: 1, query: "action:create") {
          nodes {
            id
            createdAt
            message

            ... on BasicEvent {
              appTitle
              attributeToApp
              attributeToUser
            }
          }
        }

        discount {
          __typename

          ... on DiscountAutomaticBasic {
            title
            status
            summary
            startsAt
            endsAt
            discountClasses

            customerGets {
              ...CustomerGetsFields
            }

            minimumRequirement {
              ...MinimumRequirementFields
            }
          }

          ... on DiscountCodeBasic {
            title
            status
            summary
            startsAt
            endsAt
            discountClasses

            codesCount { count }
            codes(first: 5) {
              nodes {
                code
              }
            }

            customerGets {
              ...CustomerGetsFields
            }

            minimumRequirement {
              ...MinimumRequirementFields
            }
          }

          ... on DiscountAutomaticBxgy {
            title
            status
            summary
            startsAt
            endsAt
            discountClasses

            customerGets {
              ...CustomerGetsFields
            }
          }

          ... on DiscountCodeBxgy {
            title
            status
            summary
            startsAt
            endsAt
            discountClasses

            codesCount { count }
            codes(first: 5) {
              nodes {
                code
              }
            }

            customerGets {
              ...CustomerGetsFields
            }
          }

          ... on DiscountAutomaticFreeShipping {
            title
            status
            summary
            startsAt
            endsAt
            discountClasses

            minimumRequirement {
              ...MinimumRequirementFields
            }
          }

          ... on DiscountCodeFreeShipping {
            title
            status
            summary
            startsAt
            endsAt
            discountClasses

            codesCount { count }
            codes(first: 5) {
              nodes {
                code
              }
            }

            minimumRequirement {
              ...MinimumRequirementFields
            }
          }
        }
  }
`;

// A shared set of fragments used by the discount queries.
const SHARED_FRAGMENTS = `

  fragment CustomerGetsFields on DiscountCustomerGets {
    value {
      __typename

      ... on DiscountPercentage {
        percentage
      }

      ... on DiscountAmount {
        amount {
          amount
          currencyCode
        }

        appliesOnEachItem
      }

      ... on DiscountOnQuantity {
        quantity {
          quantity
        }

        effect {
          __typename

          ... on DiscountPercentage {
            percentage
          }

          ... on DiscountAmount {
            amount {
              amount
              currencyCode
            }

            appliesOnEachItem
          }
        }
      }
    }

    items {
      __typename

      ... on AllDiscountItems {
        allItems
      }

      ... on DiscountProducts {
        products(first: 50) {
          nodes {
            id
            title
          }
        }

        productVariants(first: 50) {
          nodes {
            id
            title
          }
        }
      }

      ... on DiscountCollections {
        collections(first: 50) {
          nodes {
            id
            title
          }
        }
      }
    }
  }

  fragment MinimumRequirementFields on DiscountMinimumRequirement {
    __typename

    ... on DiscountMinimumSubtotal {
      greaterThanOrEqualToSubtotal {
        amount
        currencyCode
      }
    }

    ... on DiscountMinimumQuantity {
      greaterThanOrEqualToQuantity
    }
  }
`;

/**
 * One page of the shop's discounts, newest first. Forward with `first` and `after`, back with `last` and `before`;
 * `query` is Shopify's discount search (free text, status:active, and so on).
 */
export const GET_DISCOUNTS_PAGE = `#graphql
  query GetDiscountsPage($first: Int, $after: String, $last: Int, $before: String, $query: String) {
    discountNodes(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: ID, reverse: true) {
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      nodes { ...ListDiscountNode }
    }
    discountNodesCount(query: $query, limit: 10000) { count precision }
  }
  ${LIST_DISCOUNT_NODE}
  ${SHARED_FRAGMENTS}
`;

/** Specific discounts by id (up to 250), for when the list is not the way to find them. */
export const GET_DISCOUNTS_BY_IDS = `#graphql
  query GetDiscountsByIds($ids: [ID!]!) {
    nodes(ids: $ids) { ... on DiscountNode { ...ListDiscountNode } }
  }
  ${LIST_DISCOUNT_NODE}
  ${SHARED_FRAGMENTS}
`;

