import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import crypto from 'crypto';
import bigInt from 'big-integer';

dotenv.config();

// 1. Load your bot token from environment or config
const bot = new Telegraf(process.env.BOT_TOKEN);

/**
 * Create an invoice link for Telegram Stars payment (XTR).
 *
 * @param {string} title         The title of the invoice.
 * @param {string} description   A short description of the product or purchase.
 * @param {string} payload       A JSON string or other data you want to attach to the invoice (bot-side).
 * @param {string} providerToken For standard payments, you'd pass your BotFather-issued token.
 *                               For Telegram Stars, this can be an empty string.
 * @param {string} currency      Usually "XTR" for Telegram Stars, but can be "USD"/"RUB"/etc. for others.
 * @param {Array<{ amount: number, label: string }>} prices 
 *   An array of `{ amount, label }` describing the price. 
 *   For XTR, `amount` is an integer representing that many stars.
 *
 * @returns {Promise<string>} A direct link that opens the Telegram Payment UI (Stars Payment Drawer).
 */
async function createInvoiceLink(
  title,
  description,
  payload,
  providerToken, 
  currency,
  prices
) {
  try {
    const link = await bot.telegram.createInvoiceLink({
      title,
      description,
      payload,
      provider_token: providerToken,
      currency,
      prices
    });

    return link; // e.g. "https://t.me/YourBotName?start=XXXX"
  } catch (error) {
    console.error('Error creating invoice link:', error);
    throw error;
  }
}


bot.on('pre_checkout_query', async (ctx) => {
  try {
    console.log('Received pre_checkout_query:', ctx.update.pre_checkout_query);

    const query = ctx.update.pre_checkout_query;

    // Example: Validate the payload or price if necessary
    const { id, from, invoice_payload } = query;

    if (invoice_payload !== '{}') {
      console.error('Invalid payload:', invoice_payload);
      await ctx.answerPreCheckoutQuery(false, 'Invalid payment payload.');
      return;
    }

    // Approve the payment
    await ctx.answerPreCheckoutQuery(true);
    console.log('Payment approved for:', from.username);
  } catch (error) {
    console.error('Error handling pre_checkout_query:', error);
    await ctx.answerPreCheckoutQuery(false, 'Failed to process payment.');
  }
});

/**
 * Handle successful payments.
 */
bot.on('successful_payment', (ctx) => {
  console.log('Payment successful:', ctx.message.successful_payment);
  ctx.reply('Thank you for your payment!');
});

/**
 * Fetches 2FA password parameters from Telegram.
 */
async function getPasswordParams() {
  try {
    const passwordDetails = await bot.telegram.callApi('account.getPassword');
    console.log('Password Details Response:', passwordDetails); // Log the full response

    if (!passwordDetails) {
      throw new Error('No response from account.getPassword API. Check bot permissions or API availability.');
    }

    if (!passwordDetails.srp_id || !passwordDetails.srp_B || !passwordDetails.current_salt) {
      throw new Error('Missing required fields in password details response');
    }

    return passwordDetails; // Contains srp_id, salt, and srp_B
  } catch (error) {
    console.error('Error fetching password details:', error);
    throw error;
  }
}


/**
 * Create an SRP password check payload for Telegram's payments API.
 */
const createPasswordCheckPayload = async (password, passwordParams) => {
  const { srp_id, srp_B, current_salt } = passwordParams;

  const g = bigInt(2);
  const N = bigInt(
    'AC6BDB41324A9A9BF166DE5E1389582FAF72B665198FFB3E2C6D9A8C12AD3D9A86917F1FE55E7182967C2E4D' +
    'FCE10D86AA6D5FDEDD532F3A942D5EEC0A3C9CEFAF9643DB81E2AFCBDC7D465F20AB4FA91852C1696F769A9A2C',
    16
  );

  const salt = Buffer.from(current_salt, 'base64');
  const passwordBytes = Buffer.from(password, 'utf-8');
  const passwordHash = crypto.createHash('sha256').update(Buffer.concat([salt, passwordBytes])).digest();

  const x = bigInt(passwordHash.toString('hex'), 16);
  const a = bigInt(crypto.randomBytes(256).toString('hex'), 16);
  const A = g.modPow(a, N);

  const B = bigInt(srp_B, 16);
  const uHash = crypto.createHash('sha256').update(Buffer.concat([A.toArray(256).value, B.toArray(256).value])).digest();
  const u = bigInt(uHash.toString('hex'), 16);

  const S = B.subtract(g.modPow(x, N)).modPow(a.add(u.multiply(x)), N);
  const M1Hash = crypto.createHash('sha256').update(Buffer.concat([A.toArray(256).value, B.toArray(256).value, S.toArray(256).value])).digest();

  return {
    _: 'inputCheckPasswordSRP',
    srp_id,
    A: A.toString(16),
    M1: M1Hash.toString('hex'),
  };
};

/**
 * Get the Stars revenue withdrawal URL.
 */
async function getStarsRevenueWithdrawalUrl(starsAmount, password) {
  try {
    // Fetch password parameters
    const passwordParams = await getPasswordParams();

    // Generate SRP password payload
    const passwordPayload = await createPasswordCheckPayload(password, passwordParams);

    // Call Telegram's payments.getStarsRevenueWithdrawalUrl API
    const response = await bot.telegram.callApi('payments.getStarsRevenueWithdrawalUrl', {
      peer: {
        _: 'inputPeerSelf',
      },
      stars: starsAmount,
      password: passwordPayload,
    });

    console.log('Withdrawal URL Response:', response); // Log the raw response
    return response.url;
  } catch (error) {
    console.error('Error in getStarsRevenueWithdrawalUrl:', error);
    throw error;
  }
}

// Export botApi
export const botApi = {
  bot,
  createInvoiceLink,
  getStarsRevenueWithdrawalUrl,
};