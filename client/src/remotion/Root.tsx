import { Composition } from 'remotion';
import { AudnixVideo } from './AudnixVideo';

export const RemotionRoot: React.FC = () => {
    return (
        <>
            <Composition
                id="AudnixPromo"
                component={AudnixVideo}
                durationInFrames={300}
                fps={30}
                width={1920}
                height={1080}
            />
        </>
    );
};
