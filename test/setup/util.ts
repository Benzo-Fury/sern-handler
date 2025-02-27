import { faker } from "@faker-js/faker"
import { CommandInitPlugin, CommandType, Module, controller } from "../../src"
import { Processed } from "../../src/types/core-modules"
import { vi } from 'vitest'

export function createRandomInitPlugin (s: 'go', mut?: Partial<Module>) {
    return CommandInitPlugin(({ module }) => {
        if(mut) {
            Object.entries(mut).forEach(([k, v]) => {
                module[k] = v
            })
        }
        return  s == 'go'
            ? controller.next()
            : controller.stop()
    })
}

export function createRandomModule(plugins: any[]): Processed<Module> {
    return {
        type: CommandType.Both,
        meta: { id:"", absPath: "" },
        description: faker.string.alpha(),
        plugins, 
        name: "cheese",
        onEvent: [],
        locals: {},
        execute: vi.fn(),
    };
}
