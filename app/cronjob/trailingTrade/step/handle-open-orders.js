/* eslint-disable no-await-in-loop */
const moment = require('moment');
const _ = require('lodash');

const { messenger, binance, mongo } = require('../../../helpers');
const {
  getAndCacheOpenOrdersForSymbol,
  getAccountInfoFromAPI,
  getAPILimit
} = require('../../trailingTradeHelper/common');

/**
 * Cancel order
 *
 * @param {*} logger
 * @param {*} symbol
 * @param {*} order
 */
const cancelOrder = async (logger, symbol, order) => {
  logger.info(
    { debug: true, function: 'cancelOrder', order },
    'Cancelling open orders'
  );
  // Cancel open orders first to make sure it does not have unsettled orders.
  let result = false;
  try {
    const apiResult = await binance.client.cancelOrder({
      symbol,
      orderId: order.orderId
    });
    logger.info({ apiResult }, 'Cancelled open orders');

    result = true;
  } catch (e) {
    logger.info(
      { e },
      'Cancel failed, but it is ok. The order may already be executed. We just wait for next round to be handled'
    );
  }

  return result;
};

const calculateLastBuyPrice = async (logger, symbol, price, quantity) => {
  const lastBuyPriceDoc = await getLastBuyPrice(logger, symbol);

  const orgLastBuyPrice = _.get(lastBuyPriceDoc, 'lastBuyPrice', 0);
  const orgQuantity = _.get(lastBuyPriceDoc, 'quantity', 0);
  const orgTotalAmount = orgLastBuyPrice * orgQuantity;

  const filledQuoteQty = price;
  const filledQuantity = quantity;
  const filledTotalAmount = (filledQuoteQty * filledQuantity);

  const newQuantity = (orgQuantity + filledQuantity);
  const newTotalAmount = (orgTotalAmount + filledTotalAmount);

  const newLastBuyPrice = (newTotalAmount / newQuantity);


  await saveLastBuyPrice(logger, symbol, {
    lastBuyPrice: newLastBuyPrice,
    quantity: newQuantity
  });

  PubSub.publish('frontend-notification', {
    type: 'success',
    title: `New last buy price for ${symbol} has been updated.`
  });

  return;
};

/**
 *
 * Handle open orders
 *
 * @param {*} logger
 * @param {*} rawData
 */
const execute = async (logger, rawData) => {
  const data = rawData;

  const {
    symbol,
    featureToggle,
    action,
    isLocked,
    openOrders,
    buy: { limitPrice: buyLimitPrice },
    sell: { limitPrice: sellLimitPrice },
    indicators: { trendDiff },
    symbolConfiguration: { strategyOptions: { huskyOptions: { buySignal, sellSignal } } }
  } = data;

  if (isLocked) {
    logger.info(
      { isLocked },
      'Symbol is locked, do not process handle-open-orders'
    );
    return data;
  }

  if (action !== 'not-determined') {
    logger.info(
      { action },
      'Action is already defined, do not try to handle open orders.'
    );
    return data;
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const order of openOrders) {
    if (order.type !== 'STOP_LOSS_LIMIT') {
      // eslint-disable-next-line no-continue
      continue;
    }
    // Is the stop price is higher than current limit price?
    if (order.side.toLowerCase() === 'buy') {
      let isHuskySignalActivated = false;
      if (buySignal) {
        isHuskySignalActivated = Math.sign(trendDiff) == -1;
      }
      if (parseFloat(order.stopPrice) >= buyLimitPrice || isHuskySignalActivated) {
        logger.info(
          { stopPrice: order.stopPrice, buyLimitPrice },
          'Stop price is higher than buy limit price, cancel current buy order'
        )

        // Cancel current order
        const cancelResult = await cancelOrder(logger, symbol, order);
        if (cancelResult === false) {
          // If cancelling the order is failed, it means the order may already be executed or does not exist anymore.
          // Hence, refresh the order and process again in the next tick.
          // Get open orders and update cache

          data.openOrders = await getAndCacheOpenOrdersForSymbol(
            logger,
            symbol
          );

          data.buy.openOrders = data.openOrders.filter(
            o => o.side.toLowerCase() === 'buy'
          );

          // Refresh account info
          data.accountInfo = await getAccountInfoFromAPI(logger);

          data.action = 'buy-order-checking';

          let orderResult;
          try {
            orderResult = await binance.client.getOrder({
              symbol,
              orderId: order.orderId
            });
            if (orderResult.status === 'FILLED') {
              await calculateLastBuyPrice(logger, symbol, order.limitPrice, order.quantity);
            } else {
              await mongo.deleteOne(logger, 'trailing-trade-symbols', {
                key: `${symbol}-last-buy-price`
              });
              messenger.sendMessage(
                symbol, null, 'REMOVE_LAST_BUY');
            }
          } catch {
            messenger.errorMessage("Couldn't verify the open order. Trying again.")
          }

          if (_.get(featureToggle, 'notifyDebug', false) === true) {
            messenger.sendMessage(
              symbol, order, 'CANCEL_BUY_FAILED');
          }
        } else {
          // Reset buy open orders
          data.buy.openOrders = [];

          // Set action as buy
          data.action = 'buy';

          // Get account information again because the order is cancelled
          data.accountInfo = await getAccountInfoFromAPI(logger);
        }
      } else {
        logger.info(
          { stopPrice: order.stopPrice, buyLimitPrice },
          'Stop price is less than buy limit price, wait for buy order'
        );
        // Set action as buy
        data.action = 'buy-order-wait';
      }
    }

    // Is the stop price is less than current limit price?
    if (order.side.toLowerCase() === 'sell') {
      let isHuskySignalActivated = false;
      if (sellSignal) {
        isHuskySignalActivated = Math.sign(trendDiff) == 1;
      }
      if (parseFloat(order.stopPrice) <= sellLimitPrice || isHuskySignalActivated) {
        logger.info(
          { stopPrice: order.stopPrice, sellLimitPrice },
          'Stop price is less than sell limit price, cancel current sell order'
        );

        // Cancel current order
        const cancelResult = await cancelOrder(logger, symbol, order);
        if (cancelResult === false) {
          // If cancelling the order is failed, it means the order may already be executed or does not exist anymore.
          // Hence, refresh the order and process again in the next tick.
          // Get open orders and update cache

          data.openOrders = await getAndCacheOpenOrdersForSymbol(
            logger,
            symbol
          );

          data.sell.openOrders = data.openOrders.filter(
            o => o.side.toLowerCase() === 'sell'
          );

          // Refresh account info
          data.accountInfo = await getAccountInfoFromAPI(logger);

          data.action = 'sell-order-checking';

          if (_.get(featureToggle, 'notifyDebug', false) === true) {
            messenger.sendMessage(
              symbol, order, 'CANCEL_SELL_FAILED');
          }

        } else {
          // Reset sell open orders
          data.sell.openOrders = [];

          // Set action as sell
          data.action = 'sell';

          // Get account information again because the order is cancelled
          data.accountInfo = await getAccountInfoFromAPI(logger);
        }
      } else {
        logger.info(
          { stopPrice: order.stopPrice, sellLimitPrice },
          'Stop price is higher than sell limit price, wait for sell order'
        );
        data.action = 'sell-order-wait';
      }
    }
    logger.info({ action: data.action }, 'Determined action');
  }

  return data;
};

module.exports = { execute };
