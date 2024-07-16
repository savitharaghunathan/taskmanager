import * as vscode from 'vscode';
import { MyTaskProvider, Requests, getTaskCounter, incrementTaskCounter, addRequest, runningTasks, removeRequestById, getRequests } from './taskprovider';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Task Log');
    outputChannel.show(true); 

    const taskProvider = new MyTaskProvider(outputChannel);
    context.subscriptions.push(vscode.tasks.registerTaskProvider('mytasks', taskProvider));

    context.subscriptions.push(vscode.commands.registerCommand('extension.createTask', async () => {
        const taskType = await vscode.window.showQuickPick(['kai', 'kantra'], { placeHolder: 'Select task type' });
        if (!taskType) {
            vscode.window.showErrorMessage('Task type is required.');
            return;
        }

        const taskRequest: Requests = { id: getTaskCounter(), name: `Task-${getTaskCounter()}`, counter: getTaskCounter(), type: taskType as 'kai' | 'kantra' };
        addRequest(taskRequest);
        incrementTaskCounter();
        outputChannel.appendLine(`Task ${JSON.stringify(taskRequest)} created and added to queue.`);
    }));

	context.subscriptions.push(vscode.commands.registerCommand('extension.cancelTask', async () => {
        const runningTaskIds = Array.from(runningTasks.keys()).map(id => id.toString());
        const waitingTaskIds = getRequests().map(request => request.id.toString());
        const taskIds = runningTaskIds.concat(waitingTaskIds);

        const taskIdStr = await vscode.window.showQuickPick(taskIds, { placeHolder: 'Select Task ID to cancel' });
        if (taskIdStr) {
            const taskId = parseInt(taskIdStr);
            taskProvider.cancelTask(taskId);
            removeRequestById(taskId); 
        }
    }));

    context.subscriptions.push(outputChannel);
}

export function deactivate() {}
