import express from 'express';
import { User, Member, ReturnedUser, Info } from '../interfaces';

import argon2 from 'argon2';
    import { SignJWT } from 'jose/jwt/sign';
    import { importPKCS8 } from 'jose/key/import';
import { Client } from 'pg';

export default (websockets: Map<string, WebSocket[]>, app: express.Application, database: Client) => {
    app.get('/users/@me/guilds', (req: express.Request, res: express.Response) => {
        database.query(`SELECT * FROM guilds`, (err, dbRes) => {
            if (!err) {
                const guilds = dbRes.rows.filter(x => x?.members?.includes(res.locals.user));
                        res.send(guilds.map(guild => Object.keys(guild).reduce((obj, key, index) => ({ ...obj, [key]: Object.keys(guild).map(x => x == 'channels' || x == 'members' || x == 'roles' ? JSON.parse(guild[x]) : guild[x])[index] }), {})));
            } else {
                res.status(500).send({});
            }
        });
});

app.delete('/users/@me/guilds/*', (req: express.Request, res: express.Response) => {
    const urlParamsValues: string[] = Object.values(req.params);
        const guildId = urlParamsValues
            .map((x) => x.replace(/\//g, ''))
            .filter((x) => {
                return x != '';
            })[0];
        if (guildId) {
            database.query(`SELECT * FROM guilds`, (err, dbRes) => {
                if (!err) {
                    const guild = dbRes.rows.find(x => x?.id == guildId);
                    if (guild) {
                        const members = JSON.parse(guild.members);
                        if (members.find((x: Member) => x?.id == res.locals.user) && !members.find((x: Member) => x?.id == res.locals.user)?.roles.includes("0")) {
                            members.splice(members.indexOf(res.locals.user), 1);
                            database.query(`UPDATE guilds SET members = $1`, [JSON.stringify(members)], (err, dbRes) => {
                                if (!err) {
                                        res.status(200).send(guild);
                                    } else {
                                        res.status(500).send({});
                                    }
                            });
                        } else {
                            res.status(401).send({});
                        }
                    } else {
                        res.status(404).send({});
                    }
                } else {
                    res.status(500).send({});
                }
            });
        } else {
            res.status(404).send({});
        }
});

    app.get('/users/@me', async (req: express.Request, res: express.Response) => {
            database.query(`SELECT * FROM users`, async (err, dbRes) => {
                if (!err) {
                    const user = dbRes.rows.find(x => x.token == req.headers.authorization);
                    let preReturnedUser: User = Object.keys(user).reduce((obj, key, index) => ({ ...obj, [key]: Object.keys(user).map(x => user[x])[index] }), {}) as User; 
                                const { token, email, password, ...rest } = preReturnedUser;
                                const returnedUser: ReturnedUser = rest;
                    res.send(returnedUser);
                } else {
                    res.status(500).send({});
                }
            });
    });

    app.get('/users/*', async (req: express.Request, res: express.Response) => {
        const urlParamsValues: string[] = Object.values(req.params);
        const userId = urlParamsValues
            .map((x) => x.replace(/\//g, ''))
            .filter((x) => {
                return x != '';
            })[0];
            database.query(`SELECT * FROM users`, async (err, dbRes) => {
                if (!err) {
                    const user = dbRes.rows.find(x => x.id == userId);
                    if (user) {
                        let preReturnedUser: User = Object.keys(user).reduce((obj, key, index) => ({ ...obj, [key]: Object.keys(user).map(x => user[x])[index] }), {}) as User; 
                                const { token, email, password, ...rest } = preReturnedUser;
                                const returnedUser: ReturnedUser = rest;
                        res.send(returnedUser);
                    } else {
                        res.status(404).send({});
                    }
                } else {
                    res.status(500).send({});
                }
            });
    });

    app.delete('/users/@me', async (req: express.Request, res: express.Response) => {
        database.query(`SELECT * FROM users`, async (err, dbRes) => {
            if (!err) {
                const user = dbRes.rows.find(x => x.id == res.locals.user);
            database.query(`DELETE FROM users WHERE token = '${req.headers.authorization}'`, async (err, dbRes) => {
                if (!err) {
                    let preReturnedUser: User = Object.keys(user).reduce((obj, key, index) => ({ ...obj, [key]: Object.keys(user).map(x => user[x])[index] }), {}) as User; 
                                const { token, email, password, ...rest } = preReturnedUser;
                                const returnedUser: ReturnedUser = rest;
                         websockets.get(user.id)?.forEach(websocket => {
                        websocket.send(JSON.stringify({ event: 'userDeleted', user: returnedUser }));
                    });
                    res.send(returnedUser);
                } else {
                    res.status(500).send({});
                }
            });
        } else {
            res.status(500).send({});
        }
    });
    });

    app.patch('/users/@me', async (req: express.Request, res: express.Response) => {
            if ((req.body.username && req.body.username.length < 31) || req.body.password) {
                database.query(`SELECT * FROM users`, async (err, dbRes) => {
                    if (!err) {
                        const user = dbRes.rows.find(x => x.id == res.locals.user);
                        const discriminator = dbRes.rows.find(x => x.username == req.body.username && x.discriminator == user.discriminator) ? generateDiscriminator(dbRes.rows.filter(x => x.username == req.body.username)) : user.discriminator;
                        const token = req.body.password ? 'Bearer ' + await generateToken({ id: user.id }) : user.token;
                        database.query(`UPDATE users SET username = $1, discriminator = $2, password = $3, token = $4 WHERE id = $5`, [req.body.username ?? user.username, discriminator, await argon2.hash(req.body.password ?? user.password, { type: argon2.argon2id }), token, user.id], err => {
                            if (!err) {
                                let preReturnedUser: User = Object.keys(user).reduce((obj, key, index) => ({ ...obj, [key]: Object.keys(user).map(x => user[x])[index] }), {}) as User; 
                                preReturnedUser.username = req.body.username;
                                preReturnedUser.discriminator = discriminator;
                                const { token, email, password, ...rest } = preReturnedUser;
                                const returnedUser: ReturnedUser = rest;
        
                                     websockets.get(user.id)?.forEach(websocket => {
                                    websocket.send(JSON.stringify({ event: 'userEdited', user: returnedUser }));
                                });
                                res.send(returnedUser);
                            } else {
                                res.status(500).send({});
                            }
                        });
                    } else {
                        res.status(500).send({});
                    }
                });
            } else {
                res.status(400).send({});
            }
    });

    function generateDiscriminator(excluded: string[]): string {
        const pre = Math.floor(Math.random() * (9999 - 1 + 1) + 1);
        const final = pre.toString().padStart(4, '0');
        if (excluded.includes(final)) {
            return generateDiscriminator(excluded);
        } else {
            return final;
        }
    }

    async function generateToken(info: Info) {
        const privateKey = await importPKCS8(require('fs').readFileSync(__dirname + '/../../private.key').toString(), 'ES256');
        return await new SignJWT({ info })
            .setProtectedHeader({ alg: 'ES256' })
            .setIssuedAt()
            .setIssuer('seltorn')
            .setAudience('seltorn')
            .setExpirationTime('7d')
            .sign(privateKey);
    }
};