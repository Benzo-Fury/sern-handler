import { handleCrash } from './handlers/_internal';
import callsites from 'callsites';
import { err, ok, Files } from './core/_internal';
import { merge } from 'rxjs';
import { Services } from './core/ioc';
import { Wrapper } from './types/core';
import { eventsHandler } from './handlers/user-defined-events';
import { startReadyEvent } from './handlers/ready-event';
import { messageHandler } from './handlers/message-event';
import { interactionHandler } from './handlers/interaction-event';
import { presenceHandler } from './handlers/presence';
import { Client } from 'discord.js';

/**
 * @since 1.0.0
 * @param wrapper Options to pass into sern.
 * Function to start the handler up
 * @example
 * ```ts title="src/index.ts"
 * Sern.init({
 *     commands: 'dist/commands',
 *     events: 'dist/events',
 * })
 * ```
 */

export function init(maybeWrapper: Wrapper | 'file') {
    const startTime = performance.now();
    const wrapper = Files.loadConfig(maybeWrapper);
    const dependencies = useDependencies();
    const logger = dependencies[2],
        errorHandler = dependencies[1];

    if (wrapper.events !== undefined) {
        eventsHandler(dependencies, Files.getFullPathTree(wrapper.events));
    }
    const initCallsite = callsites()[1].getFileName();
    const presencePath = Files.shouldHandle(initCallsite!, "presence");
    //Ready event: load all modules and when finished, time should be taken and logged
    startReadyEvent(dependencies, Files.getFullPathTree(wrapper.commands))
        .add(() => {
            const time = ((performance.now() - startTime) / 1000).toFixed(2);
            dependencies[0].emit('modulesLoaded');
            logger?.info({ message: `sern: registered all modules in ${time} s`, });
            if(presencePath.exists) {
                const setPresence = async (p: any) => {
                    return (dependencies[4] as Client).user?.setPresence(p);
                }
                presenceHandler(presencePath.path, setPresence).subscribe();
            }
        });

    const messages$ = messageHandler(dependencies, wrapper.defaultPrefix);
    const interactions$ = interactionHandler(dependencies);
    // listening to the message stream and interaction stream
    merge(messages$, interactions$).pipe(handleCrash(errorHandler, logger)).subscribe();
}

function useDependencies() {
    return Services(
        '@sern/emitter',
        '@sern/errors',
        '@sern/logger',
        '@sern/modules',
        '@sern/client',
    );
}


