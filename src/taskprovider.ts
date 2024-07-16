import * as vscode from 'vscode';

export interface Requests {
    id: number;
    name: string;
    counter: number;
    type: 'kai' | 'kantra';
}

let taskcounter = 0;
let requests: Requests[] = [];

export const runningTasks = new Map<number, { taskExecution: vscode.TaskExecution, workerType: 'kai' | 'kantra' }>();

export function getTaskCounter() {
    return taskcounter;
}

export function incrementTaskCounter() {
    taskcounter++;
}

export function getRequests() {
    return requests;
}

export function addRequest(request: Requests) {
    requests.push(request);
    console.log(`Task added to queue: ${JSON.stringify(request)}`);
}

class ProcessController {
    private maxKaiWorkers: number;
    private maxKantraWorkers: number;
    private activeKaiTasks: Set<number>;
    private activeKantraTasks: Set<number>;
    private outputChannel: vscode.OutputChannel;

    constructor(maxKaiWorkers: number, maxKantraWorkers: number, outputChannel: vscode.OutputChannel) {
        this.maxKaiWorkers = maxKaiWorkers;
        this.maxKantraWorkers = maxKantraWorkers;
        this.activeKaiTasks = new Set();
        this.activeKantraTasks = new Set();
        this.outputChannel = outputChannel;
        this.pollQueue();
    }

    private async pollQueue() {
        while (true) {
            await this.processQueue();
            await this.sleep(1000); // Poll every second
        }
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async processQueue() {
        for (const task of requests) {
            if (task.type === "kai" && this.activeKaiTasks.size < this.maxKaiWorkers) {
                this.activeKaiTasks.add(task.id);
                this.startTask(task);
                requests = requests.filter(req => req.id !== task.id);
            } else if (task.type === "kantra" && this.activeKantraTasks.size < this.maxKantraWorkers) {
                this.activeKantraTasks.add(task.id);
                this.startTask(task);
                requests = requests.filter(req => req.id !== task.id);
            }
        }
    }

    async startTask(request: Requests) {
        this.outputChannel.appendLine(`Starting task: ${JSON.stringify(request)}`);
        const task = new vscode.Task(
            { type: 'mytask', task: request.name, counter: request.counter, requestType: request.type },
            vscode.TaskScope.Workspace,
            request.name,
            'myTaskProvider',
            new vscode.ShellExecution(`echo "Executing task ${request.name} with counter ${request.counter}"`)
        );

        task.execution = new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
            return new SimplePseudoterminal(request, this.outputChannel, this);
        });

        const execution = await vscode.tasks.executeTask(task);
        runningTasks.set(request.id, { taskExecution: execution, workerType: request.type });
    }

    async completeTask(request: Requests) {
        if (request.type === "kai") {
            this.activeKaiTasks.delete(request.id);
        } else if (request.type === "kantra") {
            this.activeKantraTasks.delete(request.id);
        }
        runningTasks.delete(request.id); // Ensure task is removed from runningTasks map
        this.outputChannel.appendLine(`Completed task: ${JSON.stringify(request)}`);
        this.processQueue(); // Check for next task in the queue
    }

    async cancelTask(id: number) {
        this.outputChannel.appendLine(`Cancelling task with id - ${id}`);
        const exeProcess = runningTasks.get(id);
        if (exeProcess) {
            exeProcess.taskExecution.terminate();
            runningTasks.delete(id);
            this.outputChannel.appendLine(`Task ${id} cancelled.`);

            if (exeProcess.workerType === 'kai') {
                this.activeKaiTasks.delete(id);
            } else if (exeProcess.workerType === 'kantra') {
                this.activeKantraTasks.delete(id);
            }
        } else {
            // Handle case where the task is in the queue but not running
            requests = requests.filter(task => task.id !== id);
            this.outputChannel.appendLine(`Task ${id} removed from queue.`);
        }
        this.processQueue(); // Check for available tasks after cancellation
    }
}

class SimplePseudoterminal implements vscode.Pseudoterminal {
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<void>();
    private readonly request: Requests;
    private outputChannel: vscode.OutputChannel;
    private controller: ProcessController;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<void> = this.closeEmitter.event;

    constructor(request: Requests, outputChannel: vscode.OutputChannel, controller: ProcessController) {
        this.request = request;
        this.outputChannel = outputChannel;
        this.controller = controller;
    }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.runTask();
    }

    close(): void {}

    private async runTask(): Promise<void> {
        if (!runningTasks.has(this.request.id)) {
            // Task has been cancelled before it started
            this.closeEmitter.fire();
            return;
        }

        if (this.request.type === 'kai') {
            await this.callKaiBackend();
        } else if (this.request.type === 'kantra') {
            await this.runKantraBinary();
        }
        this.closeEmitter.fire();
        this.controller.completeTask(this.request);
    }

    private async callKaiBackend(): Promise<void> {
        this.outputChannel.appendLine(`Calling Kai backend for task ${this.request.name} with counter ${this.request.counter}`);
        return new Promise<void>((resolve) => {
            const timeoutId = setTimeout(() => {
                if (!runningTasks.has(this.request.id)) {
                    resolve();
                    return;
                }
                this.outputChannel.appendLine(`Kai backend processed for task ${this.request.name} with counter ${this.request.counter}`);
                resolve();
            }, 120000); // Simulate task duration of 2 minutes

            const taskExecution = runningTasks.get(this.request.id)?.taskExecution!;
            runningTasks.set(this.request.id, { taskExecution, workerType: 'kai' });
        });
    }

    private async runKantraBinary(): Promise<void> {
        this.outputChannel.appendLine(`Running Kantra task for task ${this.request.name} with counter ${this.request.counter}`);
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                if (!runningTasks.has(this.request.id)) {
                    resolve();
                    return;
                }
                this.outputChannel.appendLine(`hi from kantra`);
                resolve();
            }, 120000); // Simulate task duration of 2 minutes

            const taskExecution = runningTasks.get(this.request.id)?.taskExecution!;
            runningTasks.set(this.request.id, { taskExecution, workerType: 'kantra' });
        });
    }
}

export class MyTaskProvider implements vscode.TaskProvider {
    private processController: ProcessController;

    constructor(outputChannel: vscode.OutputChannel) {
        this.processController = new ProcessController(2, 2, outputChannel); // Initialize with 2 kai and 2 kantra workers
    }

    provideTasks(token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task[]> {
        return [];
    }

    resolveTask(task: vscode.Task, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task> {
        return undefined;
    }

    cancelTask(id: number) {
        this.processController.cancelTask(id);
    }
}
