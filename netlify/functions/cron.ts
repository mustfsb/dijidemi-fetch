import { schedule } from '@netlify/functions';
import cookieManager from '../../lib/cookie/cookieManager';

export const handler = schedule('0 * * * *', async (event) => {
    console.log('Cron job started: Refreshing cookies');
    try {
        await cookieManager.refreshCookies();
        console.log('Cookie refresh successful');
    } catch (error) {
        console.error('Cookie refresh failed:', error);
    }

    return {
        statusCode: 200,
    };
});
