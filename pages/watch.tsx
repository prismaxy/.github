import {MetaTags, useNavBar} from "../client/next/components/navbar/navigation";
import {subscribe, useBasics, useDetectPageChange, useInterval} from "../client/utils/customHooks";
import FrameHolder from "../client/next/components/frames/holder";
import {AlreadyStreaming} from "../client/next/components/frames/misc/misc";
import {useEffect, useMemo} from "react";
import {SpringPlay} from "../server/classes/playback";
import {useRecoilValue, useSetRecoilState} from "recoil";
import useNotifications, {AlreadyStreamingAtom, WatchListener} from "../client/utils/notifications";
import {PlayBackKeys} from "../server/classes/springboard";
import {GetServerSidePropsContext} from "next";
import {cleanUp, framesVideoStateAtom} from "../client/utils/playback";
import {Role} from "@prisma/client";
import {Loading} from "../client/next/components/misc/Loader";
import {useGroupWatch} from "../client/utils/groupWatch";
import ErrorBoundary from "../client/next/components/misc/ErrorBoundary";

export default function Watch({media, metaTags, room}: { media: SpringPlay, metaTags: MetaTags, room: string | null }) {
    const reset = cleanUp();
    const {isMounted} = useBasics();
    useNavBar('watch', 1, metaTags);
    const setResponse = useSetRecoilState(framesVideoStateAtom);
    const alreadyStreaming = useRecoilValue(AlreadyStreamingAtom);
    const {loading, router} = useDetectPageChange(false);
    const {modifyPresence, broadcastToSelf, user, signAsGuest, signOut} = useNotifications();
    const {connected, openSession} = useGroupWatch();

    const {clear, restart} = useInterval(() => {
        if (isMounted())
            broadcastToSelf({
                type: 'streaming',
                title: 'Streaming',
                message: 'Streaming',
                data: null
            });
    }, 10);

    const display = useMemo(() => {
        return (media.frame && !user) || loading
    }, [media, user])

    subscribe(async ({media, user}) => {
        if (media?.frame && !user)
            await signAsGuest();
    }, {media, user})

    subscribe(alreadyStreaming => {
        if (isMounted())
            if (alreadyStreaming)
                clear();
            else
                restart();
    }, alreadyStreaming);

    useEffect(() => {
        setResponse(media);
        const {logo, name, overview, backdrop, poster} = media;
        room && !connected && openSession({id: media.mediaId, auth: room});
        !media.frame && room === null && router.replace('/watch=' + media.location, undefined, {shallow: true});
        modifyPresence(`watching ${name}`, {logo, name, overview, backdrop, poster});
        return () => reset(async (response) => {
            await modifyPresence('online');
            broadcastToSelf({
                type: 'doneStreaming',
                title: response?.name || '',
                message: `${user?.session} has stopped streaming`,
                data: null
            })

            if (user?.role === Role.GUEST && response?.frame === true)
                await signOut();
        });
    }, [media, room]);

    if (display)
        return <Loading/>

    return (
        <ErrorBoundary>
            {alreadyStreaming ? <AlreadyStreaming/> : <FrameHolder room={room}/>}
            <WatchListener/>
        </ErrorBoundary>
    )
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
    let playbackKey: PlayBackKeys | undefined = undefined;
    let media: string | undefined = undefined;

    const AuthService = await import("../server/classes/auth").then(m => m.default);
    const MiddleWare = await import("../server/classes/middleware").then(m => m.default);
    const SpringBoard = await import("../server/classes/springboard").then(m => m.default);

    const authService = new AuthService();
    const middleware = new MiddleWare();
    const springboard = new SpringBoard();

    const data = await middleware.readCookie(ctx.req.cookies, 'frames-cookie');

    const presentUser = await authService.getUserFromSession(data.session);
    const userId = presentUser?.userId || 'unknown';
    const pathname = ctx.query;

    if (pathname.mediaId) {
        playbackKey = 'MEDIA';
        media = pathname.mediaId as string;
    } else if (pathname.shuffleId) {
        playbackKey = 'SHUFFLE';
        media = pathname.shuffleId as string;
    } else if (pathname.identifier) {
        playbackKey = 'IDENTIFIER';
        media = pathname.identifier as string;
    } else if (pathname.episodeId) {
        playbackKey = 'EPISODE';
        media = pathname.episodeId as string;
    } else if (pathname.playlistId) {
        playbackKey = 'PLAYLIST';
        media = pathname.playlistId as string;
    } else if (pathname.shuffleId) {
        playbackKey = 'PLAYLIST';
        media = pathname.shuffleId as string;
    } else if (pathname.roomKey) {
        playbackKey = 'ROOMKEY';
        media = pathname.roomKey as string;
    } else if (pathname.auth) {
        playbackKey = 'AUTH';
        media = pathname.auth as string;
    } else if (pathname.frame) {
        playbackKey = 'FRAME';
        media = pathname.frame as string;
    }

    if (playbackKey && media) {
        let response = await springboard.startPlayback(media, userId, true, playbackKey);
        if (response) {
            const location = playbackKey === 'FRAME' ? '/frame=' : playbackKey === 'ROOMKEY' ? '/room=' : '/watch=';
            const address = location === '/watch=' ? response.location : media;
            const room = playbackKey === 'ROOMKEY' ? media : null;
            const metaTags: MetaTags = {
                name: response.episodeName || response.name,
                overview: response.overview,
                link: location + address,
                poster: response.poster
            }

            if (pathname.resetPosition)
                response = {...response, position: 0};

            return {
                props: {
                    metaTags,
                    media: response, room
                }
            }
        }
    }

    return {
        notFound: true
    }
}
