export const GET_DISCOUNT = `#graphql
  query GetDiscount($id: ID!) {
    discountNode(id: $id) {
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
          combinesWith { productDiscounts orderDiscounts shippingDiscounts productDiscountsWithTagsOnSameCartLine }
          context {
            ...DiscountContextFields
          }

          customerGets {
            ...CustomerGetsFields
          }

          minimumRequirement {
            ...MinimumRequirementFields
          }
        }

        ... on DiscountCodeBasic {
          usageLimit
          appliesOncePerCustomer
          title
          status
          summary
          startsAt
          endsAt
          discountClasses
          combinesWith { productDiscounts orderDiscounts shippingDiscounts productDiscountsWithTagsOnSameCartLine }
          context {
            ...DiscountContextFields
          }

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
          usesPerOrderLimit
          title
          status
          summary
          startsAt
          endsAt
          discountClasses
          combinesWith { productDiscounts orderDiscounts shippingDiscounts productDiscountsWithTagsOnSameCartLine }
          context {
            ...DiscountContextFields
          }

          customerBuys {
            ...CustomerBuysFields
          }

          customerGets {
            ...CustomerGetsFields
          }
        }

        ... on DiscountCodeBxgy {
          usesPerOrderLimit
          usageLimit
          appliesOncePerCustomer
          title
          status
          summary
          startsAt
          endsAt
          discountClasses
          combinesWith { productDiscounts orderDiscounts shippingDiscounts productDiscountsWithTagsOnSameCartLine }
          context {
            ...DiscountContextFields
          }

          codesCount { count }
          codes(first: 5) {
            nodes {
              code
            }
          }

          customerBuys {
            ...CustomerBuysFields
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
          combinesWith { productDiscounts orderDiscounts shippingDiscounts productDiscountsWithTagsOnSameCartLine }
          context {
            ...DiscountContextFields
          }
          appliesOnOneTimePurchase
          appliesOnSubscription

          maximumShippingPrice {
            amount
            currencyCode
          }

          destinationSelection {
            __typename

            ... on DiscountCountryAll {
              allCountries
            }

            ... on DiscountCountries {
              countries
            }
          }

          minimumRequirement {
            ...MinimumRequirementFields
          }
        }

        ... on DiscountCodeFreeShipping {
          usageLimit
          appliesOncePerCustomer
          title
          status
          summary
          startsAt
          endsAt
          discountClasses
          combinesWith { productDiscounts orderDiscounts shippingDiscounts productDiscountsWithTagsOnSameCartLine }
          context {
            ...DiscountContextFields
          }
          appliesOnOneTimePurchase
          appliesOnSubscription

          codesCount { count }
          codes(first: 5) {
            nodes {
              code
            }
          }

          maximumShippingPrice {
            amount
            currencyCode
          }

          destinationSelection {
            __typename

            ... on DiscountCountryAll {
              allCountries
            }

            ... on DiscountCountries {
              countries
            }
          }

          minimumRequirement {
            ...MinimumRequirementFields
          }
        }
      }
    }
  }

  fragment DiscountContextFields on DiscountContext {
    __typename

    ... on DiscountBuyerSelectionAll {
      all
    }

    ... on DiscountCustomers {
      customers {
        id
        displayName
      }
    }

    ... on DiscountCustomerSegments {
      segments {
        id
        name
      }
    }
  }

  fragment CustomerBuysFields on DiscountCustomerBuys {
    value {
      __typename

      ... on DiscountQuantity {
        quantity
      }

      ... on DiscountPurchaseAmount {
        amount
      }
    }

    items {
      ...DiscountItemsFields
    }
  }

  fragment CustomerGetsFields on DiscountCustomerGets {
    appliesOnOneTimePurchase
    appliesOnSubscription
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
      ...DiscountItemsFields
    }
  }

  fragment DiscountItemsFields on DiscountItems {
    __typename

    ... on AllDiscountItems {
      allItems
    }

    ... on DiscountProducts {
      products(first: 50) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
        }
      }

      productVariants(first: 50) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
          product {
            id
            title
          }
        }
      }
    }

    ... on DiscountCollections {
      collections(first: 50) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
          productsCount {
            count
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
