import { schedule } from '@netlify/functions';
import cookieManager from '../../lib/cookie/cookieManager';

export const handler = schedule('0 */2 * * *', async (event) => {
    console.log('Cron job started: Refreshing cookies');
    try {
        await cookieManager.refreshCookies();
        console.log('Cookie refresh successful');
        return {
            statusCode: 200,
        };
    } catch (error) {
        console.error('Cookie refresh failed:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error instanceof Error ? error.message : 'Cookie refresh failed',
            }),
        };
    }
});
